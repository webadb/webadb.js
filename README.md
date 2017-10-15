## One-stop .js for Android Debug Bridge (adb) over WebUSB

```
let webusb = await Adb.open("WebUSB");
let adb = await webusb.connectAdb("host::");
let shell = await adb.shell("uname -a");
console.log(await shell.receive());
```
