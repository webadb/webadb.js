

let log = (...args) => {
  if (args[0] instanceof Error) {
    console.error.apply(console, args);
  } else {
    console.log.apply(console, args);
  }
  document.getElementById('log').innerText += args.join(' ') + '\n';
};

// let init = async () => {
//   log('init');
//   webusb = await Adb.open("WebUSB");
// };
//
// let connect = async () => {
//   await init();
//   log('connect');
//   if (webusb.isAdb()) {
//     try {
//       adb = null;
//       adb = await webusb.connectAdb("host::", () => {
//         log("Please check the screen of your " + webusb.device.productName + ".");
//       });
//     } catch (error) {
//       log(error);
//       adb = null;
//     }
//   }
// };
//
// let disconnect = async () => {
//   log('disconnect');
//   webusb.close();
// };

// let get_ip = async () => {
//   try {
//     if (!adb) throw new Error('Not connected');
//     log('get_ip');
//     let shell = await adb.shell('ip addr show to 0.0.0.0/0 scope global');
//     let response = await shell.receive();
//     let decoder = new TextDecoder('utf-8');
//     let txt = decoder.decode(response.data);
//     log(txt);
//   } catch (error) {
//     log(error);
//   }
// };

// let tcpip = async () => {
//   try {
//     if (!adb) throw new Error('Not connected');
//     let port = document.getElementById('port').value;
//     log('requesting tcpip mode on port', port);
//     await adb.tcpip(port);
//     log('tcpip connection ready');
//   } catch (error) {
//     log(error);
//   }
// };

let adb;
let webusb;

let doEverything = async () => {
  try {
    webusb = await Adb.open("WebUSB");
    log('Initialized!');
    if (!webusb.isAdb()) throw new Error("Initialization failed");
    adb = null;
    adb = await webusb.connectAdb("host::", () => {
      log("Please check the screen of your " + webusb.device.productName + ".");
    });
    if (!adb) throw new Error('Failed to connect to ADB');
    log("doEverything: connected!");
    let port = document.getElementById('port').value;
    await adb.tcpip(port);
    log('tcpip 5555 successful!, ADB over WiFi enabled on your device');
    await webusb.close();
    log("disconnected from device!");
  } catch (error) {
    console.log(error);
    log("Something went wrong:", error)
  }
};

let add_ui = () => {
  // Adb.Opt.use_checksum = false;
  Adb.Opt.debug = true;
  // Adb.Opt.dump = true;
  document.getElementById('doEverything').onclick = doEverything;

  // document.getElementById('connect').onclick = connect;
  // // document.getElementById('get_ip').onclick = get_ip;
  // document.getElementById('disconnect').onclick = disconnect;
  // document.getElementById('tcpip').onclick = tcpip;

  document.getElementById('clear').onclick = () => {
    document.getElementById('log').innerText = '';
  };
};

document.addEventListener('DOMContentLoaded', add_ui, false);
