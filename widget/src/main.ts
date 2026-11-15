import { findOwnScript, mountFromScriptTag } from './bootstrap.js';
import { defineWidgetElement } from './element.js';

// Runs when a hotel includes widget.js: register the element, then mount it next to the <script>.
defineWidgetElement();
const script = findOwnScript();
if (script !== null) mountFromScriptTag(script);
