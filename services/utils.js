var bcrypt = require('bcrypt');
var Promise = require('promise');
var fs = require('fs');

var UtilsServices = {};

function decimalAdjust(type, value, exp) {
  // Si el exp no está definido o es cero...
  if (typeof exp === 'undefined' || +exp === 0) {
    return Math[type](value);
  }
  value = +value;
  exp = +exp;
  // Si el valor no es un número o el exp no es un entero...
  if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0)) {
    return NaN;
  }
  // Shift
  value = value.toString().split('e');
  value = Math[type](+(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp)));
  // Shift back
  value = value.toString().split('e');
  return +(value[0] + 'e' + (value[1] ? (+value[1] + exp) : exp));
}

UtilsServices.ceil10 = (value, exp) => {
  return decimalAdjust('ceil', value, exp);
};

UtilsServices.crypt = password => {
  return new Promise((resolve, reject) => {
    bcrypt.genSalt(10, (err, salt) => {
      if (err) {
        reject(err);
      }

      bcrypt.hash(password, salt, (err, hash) => {
        if (err) {
          reject(err);
        } else {
          resolve(hash);
        }
      });

    });
  });
};

UtilsServices.comparePassword = (password, userPassword) => {
  return new Promise((resolve, reject) => {
    bcrypt.compare(password, userPassword, function (err, isPasswordMatch) {
      if (err) {
        reject(err);
      } else {
        resolve(isPasswordMatch);
      }
    });
  });
};

UtilsServices.readFile = (path) => {
  return new Promise((resolve, reject) => {
    fs.readFile(path, 'utf-8', function (err, file) {
      if (err) {
        reject(err);
      } else {
        resolve(file);
      }
    });
  });
};

module.exports = UtilsServices;