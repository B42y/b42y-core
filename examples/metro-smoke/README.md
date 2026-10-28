# Expo/Metro consumption smoke fixture

Copy `App.tsx` into a temporary Expo app matching the version used by `b42y-app`. Install the locally packed `@b42y/core` tarball into that app, then run `npx expo export --platform android` and inspect the rendered text on a device or emulator. The expected amount is `100` piasters. Repeat with the installed published package before a mobile release. This fixture is pending execution; Node package import success does not verify Metro or native durability.
