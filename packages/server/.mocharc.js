'use strict'

/** @type {import("mocha").MochaOptions} */
const config = {
  spec: ['modules/automate/**/*.spec.ts'],
  require: ['ts-node/register', 'test/hooks.js'],
  slow: 0,
  timeout: '150000',
  exit: true
}

module.exports = config
