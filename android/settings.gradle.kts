rootProject.name = "ClashMetaForAndroid"

include(":app")
include(":enterprise")
include(":core")
include(":service")
include(":design")
include(":common")
include(":hideapi")

pluginManagement {
    repositories {
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        maven("https://maven.aliyun.com/repository/public")
        maven("https://maven.aliyun.com/repository/google")
        mavenLocal()
        mavenCentral()
        gradlePluginPortal()
    }
}

