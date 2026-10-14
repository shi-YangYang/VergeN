export interface ManagedGroupAlias {
  name: string
  label: string
}

export const displayManagedConnection = (
  connection: IConnectionsItem,
  alias: ManagedGroupAlias | null,
): IConnectionsItem => {
  if (
    !alias ||
    alias.name === alias.label ||
    !connection.chains.includes(alias.name)
  )
    return connection
  return {
    ...connection,
    chains: connection.chains.map((name) =>
      name === alias.name ? alias.label : name,
    ),
  }
}

export const displayManagedLog = (
  payload: string,
  alias: ManagedGroupAlias | null,
): string => {
  if (!alias || alias.name === alias.label || !/^\[(TCP|UDP)\] /.test(payload))
    return payload

  const dialPrefix = `${payload.slice(0, 6)}dial ${alias.name} `
  if (payload.startsWith(dialPrefix)) {
    const remainder = payload.slice(dialPrefix.length)
    if (
      remainder.startsWith('(match ') ||
      /^(?:[0-9.]+|\[[0-9a-fA-F:%]+\]):[0-9]+(?:\(| --> )/.test(remainder)
    ) {
      return `${payload.slice(0, 6)}dial ${alias.label} ${remainder}`
    }
  }
  if (payload.slice(6).startsWith('dial ') || !payload.includes(' --> '))
    return payload

  // Mihomo formats the selected route as GROUP[node]; node names and addresses stay intact.
  const routeStart = payload.lastIndexOf(' using ')
  if (routeStart >= 0) {
    const start = routeStart + ' using '.length
    const route = payload.slice(start)
    if (
      route === alias.name ||
      (route.startsWith(`${alias.name}[`) && route.endsWith(']'))
    ) {
      return (
        payload.slice(0, start) + alias.label + route.slice(alias.name.length)
      )
    }
  }

  return payload
}
