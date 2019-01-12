'use strict';

const Homey = require('homey');
const Device = require('../../lib/Device.js');

const CAPABILITIES_MAP = {
	'onoff'				: 'on',
	'dim'				: 'brightness',
	'light_hue'			: 'hue',
	'light_saturation'	: 'saturation',
	'light_temperature'	: 'colorTemp',
	'light_mode'		: 'colorMode'
}

class DeviceBulb extends Device {
	
	_onSync() {	
		super._onSync();
		
		for( let capabilityId in CAPABILITIES_MAP ) {
			if( !this.hasCapability(capabilityId) ) continue;
			
			let propertyId = CAPABILITIES_MAP[capabilityId];
			let propertyValue = this._device[propertyId];
			let convertedValue = DeviceBulb.convertValue(capabilityId, 'get', propertyValue);
			
			if( this.getCapabilityValue('onoff') === false && capabilityId === 'dim' ) continue;
			
			this.setCapabilityValue( capabilityId, convertedValue )
				.catch( err => {
					this.error( err, 'capabilityId:', capabilityId, 'convertedValue:', convertedValue);
				});
			
		}
	}
	
	_onCapabilitiesSet( valueObj, optsObj ) {	
				
		if( typeof valueObj.dim === 'number' ) {
			valueObj.onoff = valueObj.dim > 0;	
		}
				
		for( let capabilityId in CAPABILITIES_MAP ) {
			if( !this.hasCapability(capabilityId) ) continue;
			
			let propertyId = CAPABILITIES_MAP[capabilityId];
			let capabilityValue = valueObj[capabilityId];
			if( typeof capabilityValue === 'undefined' ) capabilityValue = this.getCapabilityValue(capabilityId);
			let convertedValue = DeviceBulb.convertValue(capabilityId, 'set', capabilityValue);
			
			// only send properties for the current light_mode, so the bulb switches accordingly
			let lightMode = valueObj['light_mode'] || this.getCapabilityValue('light_mode');
			if( lightMode === 'temperature' ) {
				if( capabilityId === 'light_hue' || capabilityId === 'light_saturation' ) convertedValue = null;
			} else if( lightMode === 'color' ) {
				if( capabilityId === 'light_temperature' ) convertedValue = null;
			}
						
			if( convertedValue === null ) continue;
			
			try {
				this._setDeviceProp(propertyId, convertedValue, valueObj);
				this.setCapabilityValue(capabilityId, capabilityValue)
					.catch( this.error );
			} catch( err ) {
				this.error( err );
			}
		}
		
		for( let key in optsObj ) {
			if( typeof optsObj[key].duration === 'number' ) {
				this._device.transitionTime = optsObj[key].duration / 1000;
			}
		}
				
		return this._saveDevice();
		
	}

	_setDeviceProp(propertyId, propertyValue, valueObj) {
		if (['hue', 'saturation'].includes(propertyId) && this._device.manufacturer === 'IKEA of Sweden') {
            // Use XY lightMode for setting colors on IKEA devices
			// https://github.com/athombv/nl.philips.hue/issues/100
			const hue = (typeof valueObj.light_hue === 'number') ? valueObj.light_hue : this.getCapabilityValue('light_hue');
			const sat = (typeof valueObj.light_saturation === 'number') ? valueObj.light_saturation : this.getCapabilityValue('light_saturation');

            propertyId = 'xy';
            propertyValue = DeviceBulb.convertHueSatToXy(hue, sat, DeviceBulb.getDefaultGamut());
		}

        this._device[propertyId] = propertyValue;
	}
	
	shortAlert() {
		if( this._device instanceof Error )
			return Promise.reject(this._device);
			
		this._device.alert = 'select';
				
		return this._saveDevice();
	}
	
	longAlert() {
		if( this._device instanceof Error )
			return Promise.reject(this._device);
			
		this._device.alert = 'lselect';
				
		return this._saveDevice();
  }
	
	startColorLoop() {
		if( this._device instanceof Error )
			return Promise.reject(this._device);
			
		this._device.effect = 'colorloop';
		this._device.alert = 'none';
		
		return this._onCapabilitiesSet({
			onoff: true
		}, {});		
	}
	
	stopColorLoop() {
		if( this._device instanceof Error )
			return Promise.reject(this._device);
		
		this._device.effect = 'none';
		this._device.alert = 'none';
		
		return this._onCapabilitiesSet({
			onoff: true
		}, {});
	}
	
	setRandomColor() {
		if( this._device instanceof Error )
			return Promise.reject(this._device);

		const onoff = true;
		const light_saturation = 1;
		const light_hue = Math.random();
		const light_mode = 'color';
		
		this._device.effect = 'none';
		this._device.alert = 'none';
		
		return this._onCapabilitiesSet({
			onoff,
			light_saturation,
			light_hue,
			light_mode
		}, {});
		
	}

	brightnessIncrement( brightness, duration ) {
		if( this._device instanceof Error )
			return Promise.reject(this._device);
		
		const settingKey = 'notification_brightness_increment_deprecated';
		if( Homey.ManagerSettings.get(settingKey) !== true ) {
			Homey.ManagerSettings.set(settingKey, true);
			
			new Homey.Notification({
				excerpt: Homey.__('notification.brightness_increment_deprecated')
			})
				.register()
				.catch( this.error );
		}
		
		return this._onCapabilitiesSet({
			dim: brightness
		}, {
			dim: { duration }
		});
	}
	
	static convertValue( capabilityId, direction, value ) {
		
		if( capabilityId === 'onoff' ) {
			if( direction === 'get' ) {
				return value === true;
			} else if( direction === 'set' ) {
				return value === true;
			}
		} else if( capabilityId === 'dim' || capabilityId === 'light_saturation'  ) {
			if( direction === 'get' ) {
				return value / 254;
			} else if( direction === 'set' ) {
				return Math.ceil( value * 254 );
			}
		} else if( capabilityId === 'light_hue' ) {
			if( direction === 'get' ) {
				return value / 65535;
			} else if( direction === 'set' ) {
				return Math.ceil( value * 65535 );
			}
		} else if( capabilityId === 'light_temperature' ) {
			if( direction === 'get' ) {
				return ( value - 153 ) / ( 500 - 153 );
			} else if( direction === 'set' ) {
				return Math.ceil( 153 + value * ( 500 - 153 ) );
			}
		} else if( capabilityId === 'light_mode' ) {
			if( direction === 'get' ) {
				return ( value === 'ct' ) ? 'temperature' : 'color'
			} else if( direction === 'set' ) {
				return null;
			}
		} else {
			return value;
		}

	}

    // Based on https://github.com/ebaauw/homebridge-hue/blob/master/lib/HueLight.js
    //
    // Safe default gamut taking into account:
    // - The maximum value for CurrentX and  CurrentY, 65279 (0xfeff), as defined
    //   by the ZCL spec;
    // - A potential division by zero error for CurrentY, when translating the
    //   xy values back to hue/sat.
    static getDefaultGamut() {
        return {
            r: [0.9961, 0.0001],
            g: [0, 0.9961],
            b: [0, 0.0001]
        };
    }

    // Transform hue and saturation values to CIE 1931 xy color space values.
    static convertHueSatToXy(hue, sat, gamut) {
		const rgb = DeviceBulb.convertHueSatToRgb(hue, sat);

		return DeviceBulb.convertRgbToXy(...rgb, gamut);
    }

    // Based on https://github.com/ebaauw/homebridge-hue/blob/master/lib/HueLight.js
	//
	// Transform hue and saturation values to RGB values.
    static convertHueSatToRgb(hue, sat) {
        // HSV to RGB
        // See: https://en.wikipedia.org/wiki/HSL_and_HSV
        let H = hue;
        const S = sat;
        const V = 1;
        const C = V * S;
        H *= 6;
        const m = V - C;
        let x = (H % 2) - 1.0;
        if (x < 0) {
            x = -x
        }
        x = C * (1.0 - x);
        let R, G, B;
        switch (Math.floor(H) % 6) {
            case 0: R = C + m; G = x + m; B = m; break;
            case 1: R = x + m; G = C + m; B = m; break;
            case 2: R = m; G = C + m; B = x + m; break;
            case 3: R = m; G = x + m; B = C + m; break;
            case 4: R = x + m; G = m; B = C + m; break;
            case 5: R = C + m; G = m; B = x + m; break;
        }

        return [R, G, B];
    }

    // Based on https://github.com/ebaauw/homebridge-hue/blob/master/lib/HueLight.js
	//
	// Transform RGB values to CIE 1931 xy color space values.
    static convertRgbToXy(R, G, B, gamut) {
        // Gamma correction (inverse sRGB Companding).
        function invCompand (v) {
            return v > 0.04045 ? Math.pow((v + 0.055) / (1.0 + 0.055), 2.4) : v / 12.92
        }

        // RGB to XYZ to xyY
        // See: https://developers.meethue.com/develop/application-design-guidance/color-conversion-formulas-rgb-to-xy-and-back/
        const linearR = invCompand(R);
        const linearG = invCompand(G);
        const linearB = invCompand(B);
        const X = linearR * 0.664511 + linearG * 0.154324 + linearB * 0.162028;
        const Y = linearR * 0.283881 + linearG * 0.668433 + linearB * 0.047685;
        const Z = linearR * 0.000088 + linearG * 0.072310 + linearB * 0.986039;
        const sum = X + Y + Z;
        const p = sum === 0.0 ? { x: 0.0, y: 0.0 } : { x: X / sum, y: Y / sum };
        const q = DeviceBulb.closestInGamut(p, gamut);

        return [Math.round(q.x * 10000) / 10000, Math.round(q.y * 10000) / 10000];
    }

    // Based on https://github.com/ebaauw/homebridge-hue/blob/master/lib/HueLight.js
    //
	// Return point in color gamut closest to p.
    static closestInGamut(p, gamut) {
        // Return cross product of two points.
        function crossProduct (p1, p2) {
            return p1.x * p2.y - p1.y * p2.x;
        }

        // Return distance between two points.
        function distance (p1, p2) {
            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        // Return point on line a,b closest to p.
        function closest (a, b, p) {
            const ap = { x: p.x - a.x, y: p.y - a.y };
            const ab = { x: b.x - a.x, y: b.y - a.y };
            let t = (ap.x * ab.x + ap.y * ab.y) / (ab.x * ab.x + ab.y * ab.y);
            t = t < 0.0 ? 0.0 : t > 1.0 ? 1.0 : t;
            return { x: a.x + t * ab.x, y: a.y + t * ab.y };
        }

        const R = { x: gamut.r[0], y: gamut.r[1] };
        const G = { x: gamut.g[0], y: gamut.g[1] };
        const B = { x: gamut.b[0], y: gamut.b[1] };
        const v1 = { x: G.x - R.x, y: G.y - R.y };
        const v2 = { x: B.x - R.x, y: B.y - R.y };
        const v = crossProduct(v1, v2);
        const q = { x: p.x - R.x, y: p.y - R.y };
        const s = crossProduct(q, v2) / v;
        const t = crossProduct(v1, q) / v;
        if (s >= 0.0 && t >= 0.0 && s + t <= 1.0) {
            return p
        }
        const pRG = closest(R, G, p);
        const pGB = closest(G, B, p);
        const pBR = closest(B, R, p);
        const dRG = distance(p, pRG);
        const dGB = distance(p, pGB);
        const dBR = distance(p, pBR);
        let min = dRG;
        p = pRG;
        if (dGB < min) {
            min = dGB;
            p = pGB;
        }
        if (dBR < min) {
            p = pBR;
        }

        return p;
    }
}

module.exports = DeviceBulb;