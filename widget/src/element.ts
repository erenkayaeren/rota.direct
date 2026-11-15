import { h, render } from 'preact';
import { createApiClient, type ApiClient } from './api/client.js';
import { readConfig, type WidgetConfig } from './config.js';
import styles from './styles/widget.css?inline';
import { App } from './ui/App.js';

export const ELEMENT_NAME = 'rota-booking-widget';

/**
 * <rota-booking-widget hotel-key="pk_…" lang="auto" api-base="https://…" accent="#0b5fa5" kvkk-url="https://…">
 *
 * The whole UI lives in a Shadow DOM (ADR-0003): the host page's CSS cannot restyle it and its
 * own CSS is injected only into the shadow root, never into the page.
 */
export class RotaBookingWidget extends HTMLElement {
  /** Origin widget.js was served from; used when `api-base` is not given. Set by main.ts. */
  static defaultApiBase = '';
  /** Replaceable in tests. */
  static clientFactory: (config: WidgetConfig) => ApiClient = (config) =>
    createApiClient(config.apiBase, config.hotelKey, config.language);

  private mountPoint: HTMLElement | undefined;

  connectedCallback(): void {
    if (this.mountPoint === undefined) {
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = styles;
      this.mountPoint = document.createElement('div');
      this.mountPoint.className = 'rota-root';
      root.append(style, this.mountPoint);
    }
    this.draw();
  }

  disconnectedCallback(): void {
    if (this.mountPoint !== undefined) render(null, this.mountPoint);
  }

  private draw(): void {
    const mountPoint = this.mountPoint as HTMLElement;
    const result = readConfig(this, RotaBookingWidget.defaultApiBase || window.location.origin, navigator.languages ?? [navigator.language]);
    if (!result.ok) {
      console.error(`[rota-direct] ${result.problem}`);
      mountPoint.textContent = '';
      const notice = document.createElement('p');
      notice.setAttribute('role', 'alert');
      notice.textContent = `Rota widget configuration error: ${result.problem}`;
      mountPoint.append(notice);
      return;
    }
    if (result.config.accent !== null) this.style.setProperty('--rota-accent', result.config.accent);
    render(h(App, { config: result.config, client: RotaBookingWidget.clientFactory(result.config) }), mountPoint);
  }
}

export function defineWidgetElement(): void {
  if (!customElements.get(ELEMENT_NAME)) customElements.define(ELEMENT_NAME, RotaBookingWidget);
}
