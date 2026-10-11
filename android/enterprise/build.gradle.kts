import java.net.URL

plugins {
    kotlin("android")
    id("com.android.library")
    id("kotlinx-serialization")
}

android {
    namespace = "io.github.vergen.android.enterprise"
    compileSdk = 35
    defaultConfig {
        minSdk = 21
    }
}

dependencies {
    implementation(libs.kotlin.coroutine)
    implementation(libs.kotlin.serialization.json)
    implementation(libs.okhttp)
    implementation(project(":common"))
}
