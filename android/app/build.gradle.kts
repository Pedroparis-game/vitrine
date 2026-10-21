plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val build = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.pedroparis.vitrine"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.pedroparis.vitrine"
        minSdk = 26
        targetSdk = 34
        versionCode = build
        versionName = "1.0.$build"
    }

    // Chave fixa: assim cada versão nova instala por cima da anterior sem desinstalar.
    signingConfigs {
        create("vitrine") {
            storeFile = file("vitrine.keystore")
            storePassword = "vitrine"
            keyAlias = "vitrine"
            keyPassword = "vitrine"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("vitrine")
        }
        debug {
            signingConfig = signingConfigs.getByName("vitrine")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}
