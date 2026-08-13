# Wireless Mouse & Keyboard Remote

This workspace contains:

- A Node.js desktop server at the repo root
- An Expo Android app in [`mobile/`](./mobile)

## What Works Now

- Desktop server runs with `node server.js`
- UDP discovery broadcast from the PC
- WebSocket control channel
- Android app with:
  - auto-discovery when UDP is available
  - manual IP fallback
  - reconnect / heartbeat loop
  - trackpad mouse movement
  - left / right click buttons
  - D-pad key buttons
  - local settings persistence

## Run The Server

From the repo root:

```bash
npm install
npm start
```

Or directly:

```bash
node server.js
```

Server defaults:

- WebSocket / HTTP: `41235`
- UDP discovery: `41234`
- UDP move: `41236`

Health check:

```bash
http://YOUR_PC_IP:41235/health
```

## Run The Mobile App

Go into the mobile folder:

```bash
cd mobile
npm install
```

If you want UDP discovery and UDP movement support on Android, use an Expo development build:

```bash
npx eas build:configure
npx eas build --profile development --platform android
```

Then start the bundler:

```bash
npx expo start --dev-client
```

If you only want to test the UI shell and manual connection flow, you can also run:

```bash
npx expo start
```

## Build Locally On Your Laptop

Yes. You can build and install the Android app locally without using the EAS cloud build quota.

### Fast local dev build

If you have Android Studio and the Android SDK installed:

```bash
cd /home/web-lp-021/PersonalProjects/WirelessMouseAPK/mobile
npm install
npx expo run:android
```

For a physical Android phone over USB debugging:

```bash
npx expo run:android --device
```

### Local EAS build

If you want the EAS pipeline but running on your laptop instead of Expo's servers:

```bash
npx eas build --platform android --local
```

Notes:

- Local EAS builds need Android SDK installed on the laptop.
- Expo documents local EAS builds for Linux and macOS.
- For Windows, Expo notes local EAS builds are not officially supported, though WSL may work.

### Release-style local build

If you want a release-flavored build locally:

```bash
npx expo run:android --variant release
```

Note:

- Manual IP connection still works as the fallback path.
- The app should now launch without the earlier native-module crash.

## Connect The Phone To The PC

1. Start the server on the PC.
2. Make sure the phone and PC are on the same Wi-Fi network.
3. Open the Expo app.
4. Wait for discovery or use `Manual` to enter the PC IP.
5. Tap the discovered host or connect manually.
6. Drag on the trackpad to move the mouse.
7. Use the click buttons or D-pad buttons for basic control.

## Build Notes

- The desktop server is already structured to stay friendly to `pkg`.
- If you want a standalone Windows executable later, we can add a build script after Phase 4.
