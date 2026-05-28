buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.2.2")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.22")
    }
}

allprojects {
    // تم حذف repositories من هنا لأنها معرفة في settings.gradle.kts
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
