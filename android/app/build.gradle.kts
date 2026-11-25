import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val keystorePropsFile = rootProject.file("keystore/keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) {
        keystorePropsFile.inputStream().use { load(it) }
    }
}

val envKeystorePath = System.getenv("MASAKEN_KEYSTORE_PATH")?.trim().orEmpty()
val resolvedStoreFile = when {
    envKeystorePath.isNotEmpty() && File(envKeystorePath).exists() -> File(envKeystorePath)
    keystoreProps.getProperty("storeFile") != null -> file(keystoreProps.getProperty("storeFile"))
    else -> null
}?.takeIf { it.exists() }

val resolvedStorePassword = System.getenv("MASAKEN_KEYSTORE_PASSWORD")?.takeIf { it.isNotBlank() }
    ?: keystoreProps.getProperty("storePassword")
val resolvedKeyAlias = System.getenv("MASAKEN_KEY_ALIAS")?.takeIf { it.isNotBlank() }
    ?: keystoreProps.getProperty("keyAlias")
val resolvedKeyPassword = System.getenv("MASAKEN_KEY_PASSWORD")?.takeIf { it.isNotBlank() }
    ?: keystoreProps.getProperty("keyPassword")

android {
    namespace = "com.example.tv_guest_welcome"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.tv_guest_welcome"
        minSdk = 21
        targetSdk = 34
        versionCode = 18
        versionName = "3.3"
    }

    signingConfigs {
        getByName("debug") {
            enableV1Signing = true
            enableV2Signing = true
        }
        if (resolvedStoreFile != null && !resolvedStorePassword.isNullOrBlank() && !resolvedKeyAlias.isNullOrBlank()) {
            create("masaken") {
                storeFile = resolvedStoreFile
                storePassword = resolvedStorePassword
                keyAlias = resolvedKeyAlias
                keyPassword = resolvedKeyPassword ?: resolvedStorePassword
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    val activeSigning = signingConfigs.findByName("masaken") ?: signingConfigs.getByName("debug")

    buildTypes {
        debug {
            signingConfig = activeSigning
        }
        release {
            isMinifyEnabled = false
            signingConfig = activeSigning
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.9.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.leanback:leanback:1.0.0")
    implementation("androidx.media3:media3-exoplayer:1.3.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.3.1")
    implementation("androidx.media3:media3-ui:1.3.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
