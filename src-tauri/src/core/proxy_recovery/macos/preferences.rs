use super::State;
use anyhow::{Context as _, Result, bail, ensure};
use plist::Value;
use security_framework_sys::authorization::{
    AuthorizationCreate, AuthorizationFree, AuthorizationItem, AuthorizationRef, AuthorizationRights,
    kAuthorizationFlagDefaults, kAuthorizationFlagExtendRights,
};
use std::{ffi::c_int, ptr};
use system_configuration::{
    core_foundation::{
        array::CFArray,
        base::{CFType, TCFType},
        data::CFData,
        dictionary::CFDictionary,
        propertylist::{create_data, create_with_data, kCFPropertyListImmutable, kCFPropertyListXMLFormat_v1_0},
        string::CFString,
    },
    dynamic_store::SCDynamicStoreBuilder,
    network_configuration::{SCNetworkService, SCNetworkSet},
    preferences::SCPreferences,
    sys::{
        network_configuration::{
            SCNetworkProtocolGetConfiguration, SCNetworkProtocolSetConfiguration, SCNetworkServiceCopy,
            SCNetworkServiceCopyAll, SCNetworkServiceCopyProtocol, SCNetworkServiceGetEnabled, SCNetworkServiceGetName,
            SCNetworkSetCopyCurrent, SCNetworkSetCopyServices,
        },
        preferences::{
            SCPreferencesApplyChanges, SCPreferencesCommitChanges, SCPreferencesCreate,
            SCPreferencesCreateWithAuthorization, SCPreferencesLock, SCPreferencesUnlock,
        },
    },
};

#[link(name = "SystemConfiguration", kind = "framework")]
unsafe extern "C" {
    fn SCError() -> c_int;
}

fn prefs(authorization: AuthorizationRef) -> Result<SCPreferences> {
    let name = CFString::from_static_string("VergeN proxy recovery");
    let raw = unsafe {
        if authorization.is_null() {
            SCPreferencesCreate(ptr::null(), name.as_concrete_TypeRef(), ptr::null())
        } else {
            SCPreferencesCreateWithAuthorization(ptr::null(), name.as_concrete_TypeRef(), ptr::null(), authorization)
        }
    };
    ensure!(!raw.is_null(), "could not open macOS network preferences");
    Ok(unsafe { SCPreferences::wrap_under_create_rule(raw) })
}

struct Authorization(AuthorizationRef);

impl Drop for Authorization {
    fn drop(&mut self) {
        unsafe { AuthorizationFree(self.0, kAuthorizationFlagDefaults) };
    }
}

struct Protocol(CFType);

impl Protocol {
    fn open(prefs: &SCPreferences, scope: &str) -> Result<Self> {
        let raw =
            unsafe { SCNetworkServiceCopy(prefs.as_concrete_TypeRef(), CFString::new(scope).as_concrete_TypeRef()) };
        ensure!(!raw.is_null(), "recorded macOS network service is unavailable");
        let service = unsafe { SCNetworkService::wrap_under_create_rule(raw) };
        Self::from_service(&service).context("recorded network service has no proxy protocol")
    }

    fn from_service(service: &SCNetworkService) -> Option<Self> {
        let raw = unsafe {
            SCNetworkServiceCopyProtocol(
                service.as_concrete_TypeRef(),
                CFString::from_static_string("Proxies").as_concrete_TypeRef(),
            )
        };
        (!raw.is_null()).then(|| Self(unsafe { CFType::wrap_under_create_rule(raw.cast()) }))
    }

    fn state(&self) -> Result<State> {
        let raw = unsafe { SCNetworkProtocolGetConfiguration(self.0.as_CFTypeRef().cast()) };
        if raw.is_null() {
            return Ok(State(None));
        }
        let dict: CFDictionary = unsafe { CFDictionary::wrap_under_get_rule(raw) };
        let xml = create_data(dict.as_CFTypeRef(), kCFPropertyListXMLFormat_v1_0)
            .map_err(|_| anyhow::anyhow!("could not serialize macOS proxy settings"))?;
        Ok(State(Some(State::parse(xml.bytes())?)))
    }

    fn set(&self, desired: &State) -> Result<()> {
        let config = desired
            .0
            .as_ref()
            .map(|dict| -> Result<CFDictionary> {
                let mut bytes = Vec::new();
                Value::Dictionary(dict.clone()).to_writer_binary(&mut bytes)?;
                let (raw, _) = create_with_data(CFData::from_buffer(&bytes), kCFPropertyListImmutable)
                    .map_err(|_| anyhow::anyhow!("could not decode saved macOS proxy settings"))?;
                let object = unsafe { CFType::wrap_under_create_rule(raw) };
                object
                    .downcast_into::<CFDictionary>()
                    .context("invalid macOS proxy dictionary")
            })
            .transpose()?;
        let reference = config.as_ref().map_or(ptr::null(), TCFType::as_concrete_TypeRef);
        ensure!(
            unsafe { SCNetworkProtocolSetConfiguration(self.0.as_CFTypeRef().cast(), reference) } != 0,
            "could not stage macOS proxy settings"
        );
        Ok(())
    }
}

pub(in super::super) fn read(scope: &str) -> Result<State> {
    Protocol::open(&prefs(ptr::null_mut())?, scope)?.state()
}

pub(in super::super) fn service_scopes() -> Result<Vec<String>> {
    let prefs = prefs(ptr::null_mut())?;
    let services = unsafe { SCNetworkServiceCopyAll(prefs.as_concrete_TypeRef()) };
    ensure!(!services.is_null(), "could not enumerate macOS network services");
    let services = unsafe { CFArray::<SCNetworkService>::wrap_under_create_rule(services) };
    Ok(services
        .iter()
        .filter(|s| Protocol::from_service(s).is_some())
        .filter_map(|s| s.id())
        .map(|id| id.to_string())
        .collect())
}

fn current_set(prefs: &SCPreferences) -> Result<(SCNetworkSet, CFArray<SCNetworkService>)> {
    let set = unsafe { SCNetworkSetCopyCurrent(prefs.as_concrete_TypeRef()) };
    if set.is_null() {
        return Err(sysproxy::Error::NoActiveNetworkService.into());
    }
    let set = unsafe { SCNetworkSet::wrap_under_create_rule(set) };
    let services = unsafe { SCNetworkSetCopyServices(set.as_concrete_TypeRef()) };
    if services.is_null() {
        return Err(sysproxy::Error::NoActiveNetworkService.into());
    }
    Ok((set, unsafe { CFArray::wrap_under_create_rule(services) }))
}

fn string(dict: &CFDictionary, key: &'static str) -> Option<String> {
    let raw = *dict.find(CFString::from_static_string(key).as_CFTypeRef())?;
    unsafe { CFType::wrap_under_get_rule(raw) }
        .downcast_into::<CFString>()
        .map(|s| s.to_string())
}

pub(in super::super) fn active_scope() -> Result<String> {
    let store = SCDynamicStoreBuilder::new("VergeN proxy recovery")
        .build()
        .context("could not open macOS dynamic store")?;
    let ipv4 = store
        .get(CFString::from_static_string("State:/Network/Global/IPv4"))
        .and_then(|s| s.downcast_into::<CFDictionary>())
        .ok_or(sysproxy::Error::NoActiveNetworkService)?;
    let primary = string(&ipv4, "PrimaryService").ok_or(sysproxy::Error::NoActiveNetworkService)?;
    let prefs = prefs(ptr::null_mut())?;
    if Protocol::open(&prefs, &primary).is_ok() {
        return Ok(primary);
    }
    // The sysproxy backend resolves synthetic DHCP-en0 etc. to the first enabled service on that interface.
    let interface = string(&ipv4, "PrimaryInterface").ok_or(sysproxy::Error::NoActiveNetworkService)?;
    if interface.is_empty()
        || !["BOOTP", "DHCP", "FAILOVER", "INFORM", "LINKLOCAL", "MANUAL"]
            .iter()
            .any(|m| primary == format!("{m}-{interface}"))
    {
        return Err(sysproxy::Error::NoActiveNetworkService.into());
    }
    let (set, services) = current_set(&prefs)?;
    let order: Vec<_> = set.service_order().iter().map(|s| s.to_string()).collect();
    services
        .iter()
        .filter(|s| unsafe { SCNetworkServiceGetEnabled(s.as_concrete_TypeRef()) } != 0)
        .filter(|s| {
            s.network_interface()
                .and_then(|i| i.bsd_name())
                .is_some_and(|n| n == interface.as_str())
        })
        .filter_map(|s| s.id().map(|id| id.to_string()))
        .min_by_key(|id| order.iter().position(|item| item == id).unwrap_or(usize::MAX))
        .ok_or_else(|| sysproxy::Error::NoActiveNetworkService.into())
}

// networksetup takes a display name, not a UUID. Never redirect an old receipt to a similarly named location.
pub(super) fn networksetup_name(scope: &str) -> Result<String> {
    let (_, services) = current_set(&prefs(ptr::null_mut())?)?;
    let named: Vec<_> = services
        .iter()
        .filter_map(|service| {
            let name = unsafe { SCNetworkServiceGetName(service.as_concrete_TypeRef()) };
            if name.is_null() {
                return None;
            }
            Some((
                service.id()?.to_string(),
                unsafe { CFString::wrap_under_get_rule(name) }.to_string(),
            ))
        })
        .collect();
    let name = named
        .iter()
        .find(|(id, _)| id == scope)
        .map(|(_, name)| name)
        .context("saved service is not in the current network location")?;
    ensure!(
        !name.is_empty() && !name.starts_with('-') && named.iter().filter(|(_, other)| other == name).count() == 1,
        "ambiguous macOS network service name"
    );
    Ok(name.clone())
}

pub(super) struct Locked {
    prefs: SCPreferences,
    _authorization: Option<Authorization>,
}

impl Drop for Locked {
    fn drop(&mut self) {
        unsafe { SCPreferencesUnlock(self.prefs.as_concrete_TypeRef()) };
    }
}

impl Locked {
    fn try_new(auth: Option<Authorization>) -> Result<Option<Self>> {
        let prefs = prefs(auth.as_ref().map_or(ptr::null_mut(), |a| a.0))?;
        if unsafe { SCPreferencesLock(prefs.as_concrete_TypeRef(), 0) } == 0 {
            let code = unsafe { SCError() };
            if code == 3002 {
                bail!("macOS network preferences are busy");
            }
            return Ok(None);
        }
        Ok(Some(Self {
            prefs,
            _authorization: auth,
        }))
    }

    pub(super) fn compare_and_set(self, scope: &str, expected: &State, desired: &State) -> Result<()> {
        let protocol = Protocol::open(&self.prefs, scope)?;
        ensure!(
            protocol.state()? == *expected,
            "macOS proxy settings changed before restore"
        );
        if expected != desired {
            protocol.set(desired)?;
            ensure!(
                unsafe { SCPreferencesCommitChanges(self.prefs.as_concrete_TypeRef()) } != 0,
                "could not commit macOS proxy settings"
            );
            ensure!(
                unsafe { SCPreferencesApplyChanges(self.prefs.as_concrete_TypeRef()) } != 0,
                "could not apply macOS proxy settings"
            );
        }
        drop(self);
        ensure!(
            read(scope)? == *desired,
            "macOS proxy settings were not confirmed after write"
        );
        Ok(())
    }
}

pub(super) fn locked() -> Result<Option<Locked>> {
    if let Some(session) = Locked::try_new(None)? {
        return Ok(Some(session));
    }
    // configd requests this very right. Never give it an unapproved AuthorizationRef (it can prompt).
    let mut item = AuthorizationItem {
        name: c"system.services.systemconfiguration.network".as_ptr(),
        valueLength: 0,
        value: ptr::null_mut(),
        flags: 0,
    };
    let rights = AuthorizationRights {
        count: 1,
        items: &mut item,
    };
    let mut auth = ptr::null_mut();
    let status = unsafe {
        AuthorizationCreate(
            &raw const rights,
            ptr::null(),
            kAuthorizationFlagExtendRights,
            &raw mut auth,
        )
    };
    if status != 0 || auth.is_null() {
        return Ok(None);
    }
    Locked::try_new(Some(Authorization(auth)))
}
