/**
 * Central export surface for this package.
 * Re-exports helper functions from local modules and exposes package metadata.
 */

const { 
  sendButtons,
  sendInteractiveMessage,
  sendInteractiveMessageV2,
  getButtonType,
  getButtonArgs,
  InteractiveValidationError,
  validateAuthoringButtons,
  validateInteractiveMessageContent,
  validateSendButtonsPayload,
  validateSendInteractiveMessagePayload
} = require('./helpers/buttons');

const pkg = require('./package.json');

const getPackageInfo = () => ({
	name: pkg.name,
	version: pkg.version,
	description: pkg.description,
	author: pkg.author,
	main: pkg.main,
});

module.exports = { 
  sendButtons,
  sendInteractiveMessage,
  sendInteractiveMessageV2,
  getButtonType,
  getButtonArgs,
  InteractiveValidationError,
  validateAuthoringButtons,
  validateInteractiveMessageContent,
  validateSendButtonsPayload,
  validateSendInteractiveMessagePayload,
  pkg,
  getPackageInfo,
};
