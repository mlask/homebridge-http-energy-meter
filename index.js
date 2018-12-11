var inherits = require('util').inherits;
var Service, Characteristic;
var request = require('request');

module.exports = function (homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory("homebridge-http-energy-meter", "HttpEnergyMeter", HttpEnergyMeter);
}

function HttpEnergyMeter (log, config) {
	this.log = log;
	this.url = config["url"];
	this.auth = config["auth"];
	this.name = config["name"];
	this.model = config["model"] || "Model not available";
	this.serial = config["serial"] || "Non-defined serial";
	this.timeout = config["timeout"] || 5000;
	this.field_total = config["field_total"] || "total";
	this.http_method = config["http_method"] || "GET";
	this.manufacturer = config["manufacturer"] || "@mlask";
	this.field_current = config["field_current"] || "current";
	this.update_interval = Number(config["update_interval"] || 120000);
	
	// internal variables
	this.waiting_response = false;
	this.powerConsumption = 0;
	this.totalPowerConsumption = 0;
	
	var EvePowerConsumption = function () {
		Characteristic.call(this, 'Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT16,
			unit: 'watts',
			maxValue: 1000000000,
			minValue: 0,
			minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(EvePowerConsumption, Characteristic);
	
	var EveTotalPowerConsumption = function () {
		Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.FLOAT,
			unit: 'kilowatthours',
			maxValue: 1000000000,
			minValue: 0,
			minStep: 0.001,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(EveTotalPowerConsumption, Characteristic);
	
	var PowerMeterService = function (displayName, subtype) {
		Service.call(this, displayName, '00000001-0000-1777-8000-775D67EC4377', subtype);
		this.addCharacteristic(EvePowerConsumption);
		this.addOptionalCharacteristic(EveTotalPowerConsumption);
	};
	inherits(PowerMeterService, Service);
	
	// define service
	this.service = new PowerMeterService(this.options['name']);
	this.service.getCharacteristic(EvePowerConsumption).on('get', this.getPowerConsumption.bind(this));
	this.service.addCharacteristic(EveTotalPowerConsumption).on('get', this.getTotalPowerConsumption.bind(this));
	
	// init autoupdate
	if (this.update_interval > 0) {
		this.timer = setInterval(this.updateState.bind(this), this.update_interval);
	}
}

HttpEnergyMeter.prototype.updateState = function () {
	if (this.waiting_response) {
		this.log('Avoid updateState as previous response does not arrived yet');
		return;
	}
	this.waiting_response = true;
	this.last_value = new Promise((resolve, reject) => {
		var ops = {
			uri:		this.url,
			method:		this.http_method,
			timeout:	this.timeout
		};
		this.log('Requesting energy readings on "' + ops.uri + '", method ' + ops.method);
		if (this.auth) {
			ops.auth = {
				user: this.auth.user,
				pass: this.auth.pass
			};
		}
		request(ops, (error, res, body) => {
			var json = null;
			if (error) {
				this.log('HTTP bad response (' + ops.uri + '): ' + error.message);
			}
			else {
				try {
					json = JSON.parse(body);
					if (!this.field_current || !json[this.field_current] ||
						!this.field_total || !json[this.field_total])
						throw new Error('Received values are not valid: ' + body);
					
					this.log('HTTP successful response: ' + body);
				}
				catch (parseErr) {
					this.log('Error processing received information: ' + parseErr.message);
					error = parseErr;
				}
			}
			if (!error) {
				resolve(json[this.field_current], json[this.field_total]);
			}
			else {
				reject(error);
			}
			this.waiting_response = false;
		});
	})
	.then((value_current, value_total) => {
		this.powerConsumption = value_current;
		this.totalPowerConsumption = value_total;
		this.service.getCharacteristic(EvePowerConsumption).setValue(this.powerConsumption, undefined, undefined);
		this.service.getCharacteristic(EveTotalPowerConsumption).setValue(this.totalPowerConsumption, undefined, undefined);
		return true;
	}, (error) => {
		return error;
	});
};

HttpEnergyMeter.prototype.getPowerConsumption = function (callback) {
	callback(null, this.powerConsumption);
};

HttpEnergyMeter.prototype.getTotalPowerConsumption = function (callback) {
	callback(null, this.totalPowerConsumption);
};

HttpEnergyMeter.prototype.getServices = function () {
	return [this.service];
};