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

Note:

- UDP discovery and UDP move packets are best tested with an Expo development client.
- Manual IP connection still works as the fallback path.

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

