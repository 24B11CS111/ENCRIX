# LEADVAULT Telecaller Android App: Release Signing & Flavor Architecture

This document specifies the security protocol for signing and generating production APKs for the **LEADVAULT Telecaller Mobile Application**.

---

## 1. Product Flavors Overview

LEADVAULT Android uses three distinct build flavors:

| Flavor | Application ID | Purpose | Backend URL |
| :--- | :--- | :--- | :--- |
| **`dev`** | `com.leadvault.telecaller.dev` | Local developer builds & UI mock verification | Local / Mock |
| **`staging`** | `com.leadvault.telecaller.staging` | Cloud staging QA & test flight evaluation | Staging Supabase |
| **`prod`** | `com.leadvault.telecaller` | Production store release | Production Supabase |

---

## 2. Generating the Production Keystore

> [!CAUTION]
> NEVER commit the production keystore (`.jks` / `.keystore`) or `key.properties` to version control! Both are excluded via `.gitignore`.

Run the following command using Java `keytool` (from OpenJDK 17):

```bash
keytool -genkey -v -keystore leadvault-release-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias leadvault-telecaller-key
```

You will be prompted for:
1. Keystore password (use a strong 20+ character passphrase).
2. Key password.
3. Organization name ("LeadVault Inc.").
4. Organizational unit ("Security Engineering").

Store the resulting `leadvault-release-key.jks` in a secure secret manager (e.g. Google Cloud Secret Manager / HashiCorp Vault).

---

## 3. Configuring `key.properties`

Create a file named `android/key.properties` on the secure CI/CD build runner:

```properties
storePassword=<YOUR_STORE_PASSWORD>
keyPassword=<YOUR_KEY_PASSWORD>
keyAlias=leadvault-telecaller-key
storeFile=/secure/path/to/leadvault-release-key.jks
```

Ensure `android/key.properties` is listed in `android/.gitignore`.

---

## 4. Building the Production Release APK

To build the release APK for the production environment:

```bash
flutter build apk --release --flavor prod
```

Output location:
`android_telecaller/build/app/outputs/flutter-apk/app-prod-release.apk`

To build the staging release APK:

```bash
flutter build apk --release --flavor staging
```

Output location:
`android_telecaller/build/app/outputs/flutter-apk/app-staging-release.apk`

---

## 5. Verifying the Signature

Verify the cryptographic integrity and Android V2/V3 signature schemes using `apksigner`:

```bash
$ANDROID_SDK_ROOT/build-tools/36.0.0/apksigner verify --verbose app-prod-release.apk
```

Expected output:
```text
Verifies
Verified using v1 scheme (JAR signing): true
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v4 scheme (APK Signature Scheme v4): false
Number of signers: 1
```

---

## 6. Permissions Audit Verification

Verify that only the approved minimal permissions exist in the final manifest:

```bash
$ANDROID_SDK_ROOT/build-tools/36.0.0/aapt dump permissions app-prod-release.apk
```

Must contain ONLY:
* `android.permission.INTERNET`
* `android.permission.ACCESS_NETWORK_STATE`

**Zero** contact, telephony, microphone, or external storage permissions are permitted.
