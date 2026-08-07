const { scryptSync, randomBytes } = require('crypto');
function hashPin(pin) {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, 32);
  const result = `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
  console.log(result.includes('4826'), result);
}
for (let i = 0; i < 1000; i++) {
  hashPin('4826');
}
