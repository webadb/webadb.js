var Adb = {};

(function() {
	'use strict';

	Adb.Opt = {};
	Adb.Opt.debug = false;
	Adb.Opt.dump = false;

	Adb.open = function(transport) {
		if (transport == "WebUSB")
			return Adb.WebUSB.Transport.open();

		throw new Error("Unsupported transport: " + transport);
	};

	Adb.WebUSB = {};

	Adb.WebUSB.Transport = function(device) {
		this.device = device;

		if (Adb.Opt.debug)
			console.log(this);
	};

	Adb.WebUSB.Transport.open = function() {
		let filters = [
			{ classCode: 255, subclassCode: 66, protocolCode: 1 },
			{ classCode: 255, subclassCode: 66, protocolCode: 3 }
		];

		return navigator.usb.requestDevice({ filters: filters })
			.then(device => device.open()
				.then(() => new Adb.WebUSB.Transport(device)));
	};

	Adb.WebUSB.Transport.prototype.send = function(ep, data) {
		if (Adb.Opt.dump)
			hexdump(new DataView(data), "==> ");

		return this.device.transferOut(ep, data);
	};

	Adb.WebUSB.Transport.prototype.receive = function(ep, len) {
		return this.device.transferIn(ep, len)
			.then(response => {
				if (Adb.Opt.dump)
					hexdump(response.data, "<== ");

				return response.data;
			});
	};

	Adb.WebUSB.Transport.prototype.find = function(filter) {
		for (let i in this.device.configurations) {
			let conf = this.device.configurations[i];
			for (let j in conf.interfaces) {
				let intf = conf.interfaces[j];
				for (let k in intf.alternates) {
					let alt = intf.alternates[k];
					if (filter.classCode == alt.interfaceClass &&
					    filter.subclassCode == alt.interfaceSubclass &&
					    filter.protocolCode == alt.interfaceProtocol) {
						return { conf: conf, intf: intf, alt: alt };	
					}
				}
			}
		}

		return null;
	}

	Adb.WebUSB.Transport.prototype.isAdb = function() {
		let match = this.find({ classCode: 255, subclassCode: 66, protocolCode: 1 });
		return match != null;
	};

	Adb.WebUSB.Transport.prototype.isFastboot = function() {
		let match = this.find({ classCode: 255, subclassCode: 66, protocolCode: 3 });
		return match != null;
	};

	Adb.WebUSB.Transport.prototype.getDevice = function(filter) {
		let match = this.find(filter);
		return this.device.selectConfiguration(match.conf.configurationValue)
			.then(() => this.device.claimInterface(match.intf.interfaceNumber))
			.then(() => this.device.selectAlternateInterface(match.intf.interfaceNumber, match.alt.alternateSetting));
	};

	Adb.WebUSB.Transport.prototype.connectAdb = function(banner) {
		let VERSION = 0x01000000;
		let MAX_PAYLOAD = 4096;

		let m = new Adb.Message("CNXN", VERSION, MAX_PAYLOAD, "" + banner + "\0");
		return this.getDevice({ classCode: 255, subclassCode: 66, protocolCode: 1 })
			.then(() => new Adb.WebUSB.Device(this))
			.then(adb => m.send_receive(adb)
				.then(response => {
					if (response.cmd != "CNXN")
						throw new Error("Failed to connect with '" + banner + "'");
					if (response.arg0 != VERSION)
						throw new Error("Version mismatch: " + response.arg0 + " (expected: " + VERSION + ")");
					if (Adb.Opt.debug)
						console.log("Connected with '" + banner + "', max_payload: " + response.arg1);
					adb.max_payload = response.arg1;
					return adb;
				})
			);
	};

	Adb.WebUSB.Transport.prototype.connectFastboot = function() {
		return this.getDevice({ classCode: 255, subclassCode: 66, protocolCode: 3 })
			.then(() => new Fastboot.WebUSB.Device(this))
			.then(fastboot => fastboot.send("getvar:max-download-size")
				.then(() => fastboot.receive()
					.then(response => {
						let cmd = decode_cmd(response.getUint32(0, true));
						if (cmd == "FAIL")
							throw new Error("Unable to open Fastboot");

						fastboot.get_cmd = r => decode_cmd(r.getUint32(0, true));
						fastboot.get_payload = r => r.buffer.slice(4);
						return fastboot;
					})
				)
			);
	};

	Adb.WebUSB.Device = function(transport) {
		this.transport = transport;
		this.max_payload = 4096;
	}

	Adb.WebUSB.Device.prototype.open = function(service) {
		return Adb.Stream.open(this, service);
	};

	Adb.WebUSB.Device.prototype.shell = function(command) {
		return Adb.Stream.open(this, "shell:" + command);
	};

	Adb.WebUSB.Device.prototype.reboot = function(command="") {
		return Adb.Stream.open(this, "reboot:" + command);
	};

	Adb.WebUSB.Device.prototype.send = function(ep, data) {
		if (typeof data === "string") {
			let encoder = new TextEncoder();
			let string_data = data;
			data = encoder.encode(string_data).buffer;
		}

		if (data != null && data.length > this.max_payload)
			throw new Error("data is too big: " + data.length + " bytes (max: " + this.max_payload + " bytes)");

		return this.transport.send(ep, data);
	};

	Adb.WebUSB.Device.prototype.receive = function(ep, len) {
		return this.transport.receive(ep, len);
	};

	let Fastboot = {};
	Fastboot.WebUSB = {};

	Fastboot.WebUSB.Device = function(transport) {
		this.transport = transport;
		this.max_datasize = 64;
	};
	
	Fastboot.WebUSB.Device.prototype.send = function(data) {
		if (typeof data === "string") {
			let encoder = new TextEncoder();
			let string_data = data;
			data = encoder.encode(string_data).buffer;
		}

		if (data != null && data.length > this.max_datasize)
			throw new Error("data is too big: " + data.length + " bytes (max: " + this.max_datasize + " bytes)");

		return this.transport.send(1, data);
	};

	Fastboot.WebUSB.Device.prototype.receive = function() {
		return this.transport.receive(1, 64);
	};

	Adb.Message = function(cmd, arg0, arg1, data = null) {
		if (cmd.length != 4)
			throw new Error("Invalid command: '" + cmd + "'");

		this.cmd = cmd;
		this.arg0 = arg0;
		this.arg1 = arg1;
		this.data = data;
	};

	Adb.Message.checksum = function(data_view) {
		let sum = 0;

		for (let i = 0; i < data_view.byteLength; i++)
			sum += data_view.getUint8(i);

		return sum & 0xffffffff;
	};

	Adb.Message.send = function(device, message) {
		let header = new ArrayBuffer(24);
		let cmd = encode_cmd(message.cmd);
		let magic = cmd ^ 0xffffffff;
		let data = null;
		let len = 0;
		let checksum = 0;

		if (Adb.Opt.debug)
			console.log(message);

		if (message.data != null && message.data != "") {
			data = new TextEncoder().encode(message.data);
			len = data.length;
			data = data.buffer
			checksum = Adb.Message.checksum(new DataView(data));

			if (len > device.max_payload)
				throw new Error("data is too big: " + len + " bytes (max: " + device.max_payload + " bytes)");
		}

		let view = new DataView(header);
		view.setUint32(0, cmd, true);
		view.setUint32(4, message.arg0, true);
		view.setUint32(8, message.arg1, true);
		view.setUint32(12, len, true);
		view.setUint32(16, checksum, true);
		view.setUint32(20, magic, true);

		let seq = device.send(1, header);
		if (len > 0)
			seq.then(() => device.send(1, data));
		return seq;
	};

	Adb.Message.receive = function(device) {
		return device.receive(1, 24)
			.then(response => {
				let cmd = response.getUint32(0, true);
				let arg0 = response.getUint32(4, true);
				let arg1 = response.getUint32(8, true);
				let len = response.getUint32(12, true);
				let check = response.getUint32(16, true);
				let magic = response.getUint32(20, true);

				if ((cmd ^ magic) != -1)
					throw new Error("magic mismatch");

				cmd = decode_cmd(cmd);

				if (len == 0) {
					let message = new Adb.Message(cmd, arg0, arg1);
					if (Adb.Opt.debug)
						console.log(message);
					return message;
				}

				return device.receive(1, len)
					.then(data => {
						if (Adb.Message.checksum(data) != check)
							throw new Error("checksum mismatch");

						let message = new Adb.Message(cmd, arg0, arg1, data);
						if (Adb.Opt.debug)
							console.log(message);
						return message;
					});
			});
	};

	Adb.Message.prototype.send = function(device) {
		return Adb.Message.send(device, this);
	};

	Adb.Message.prototype.send_receive = function(device) {
		return this.send(device)
			.then(() => Adb.Message.receive(device));
	};

	Adb.Stream = function(device, service, local_id, remote_id) {
		this.device = device;
		this.service = service;
		this.local_id = local_id
		this.remote_id = remote_id;
	};

	let next_id = 1;

	Adb.Stream.open = function(device, service) {
		let local_id = next_id++;
		let remote_id = 0;

		let m = new Adb.Message("OPEN", local_id, remote_id, "" + service + "\0");
		return m.send_receive(device)
			.then(response => {
				if (response.cmd != "OKAY")
					throw new Error("Open failed");

				remote_id = response.arg0;

				if (Adb.Opt.debug) {
					console.log("Opened stream '" + service + "'");
					console.log(" local_id: 0x" + toHex32(local_id));
					console.log(" remote_id: 0x" + toHex32(remote_id));
				}

				return new Adb.Stream(device, service, local_id, remote_id);
			});
	};

	Adb.Stream.prototype.close = function() {
		if (this.local_id != 0) {
			this.local_id = 0;
			return this.send("CLSE");
		}

		if (Adb.Opt.debug) {
			console.log("Closed stream '" + this.service + "'");
			console.log(" local_id: 0x" + toHex32(this.local_id));
			console.log(" remote_id: 0x" + toHex32(this.remote_id));
		}

		this.service = "";
		this.remote_id = 0;
	};

	Adb.Stream.prototype.send = function(cmd, data=null) {
		let m = new Adb.Message(cmd, this.local_id, this.remote_id, data);
		return m.send(this.device);
	};

	Adb.Stream.prototype.receive = function() {
		return Adb.Message.receive(this.device)
			.then(response => {
				// remote's prospective of local_id/remote_id is reversed
				if (response.arg0 != 0 && response.arg0 != this.remote_id)
					throw new Error("Incorrect arg0: 0x" + toHex32(response.arg0) + " (expected 0x" + toHex32(this.remote_id) + ")");
				if (this.local_id != 0 && response.arg1 != this.local_id)
					throw new Error("Incorrect arg1: 0x" + toHex32(response.arg1) + " (expected 0x" + toHex32(this.local_id) + ")");
				return response;
			});
	};

	function paddit(text, width, padding)
	{
		let padlen = width - text.length;
		let padded = "";

		for (let i = 0; i < padlen; i++)
			padded += padding;

		return padded + text;
	}

	function toHex8(num)
	{
		return paddit(num.toString(16), 2, "0");
	}

	function toHex16(num)
	{
		return paddit(num.toString(16), 4, "0");
	}

	function toHex32(num)
	{
		return paddit(num.toString(16), 8, "0");
	}

	function hexdump(view, prefix="")
	{
		let decoder = new TextDecoder();

		for (let i = 0; i < view.byteLength; i += 16) {
			let max = (view.byteLength - i) > 16 ? 16 : (view.byteLength - i);
			let row = prefix + toHex16(i) + " ";
			let j;

			for (j = 0; j < max; j++)
				row += " " + toHex8(view.getUint8(i + j));
			for (; j < 16; j++)
				row += "   ";

			row += " | " + decoder.decode(new DataView(view.buffer, i, max));
			console.log(row);
		}
	}

	function encode_cmd(cmd)
	{
		let encoder = new TextEncoder();
		let buffer = encoder.encode(cmd).buffer;
		let view = new DataView(buffer);
		return view.getUint32(0, true);
	}

	function decode_cmd(cmd)
	{
		let decoder = new TextDecoder();
		let buffer = new ArrayBuffer(4);
		let view = new DataView(buffer);
		view.setUint32(0, cmd, true);
		return decoder.decode(buffer);
	}
})();
