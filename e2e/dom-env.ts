import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost:5110/",
  pretendToBeVisual: true,
});

(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).MouseEvent = dom.window.MouseEvent;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).getComputedStyle = dom.window.getComputedStyle;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(dom.window as any).IS_REACT_ACT_ENVIRONMENT = true;

// React 19 用 "oninput" in document 探测原生输入事件，jsdom 不具备
Object.defineProperty(dom.window.Document.prototype, "oninput", {
  configurable: true,
  value: null,
});

// 双保险：若仍走到 IE polyfill 分支，attachEvent 为空操作
dom.window.Element.prototype.attachEvent = function () {};
(dom.window.Element.prototype as any).detachEvent = function () {};

// jsdom 未实现滚动 API
(dom.window.Element.prototype as any).scrollIntoView = function () {};

export { dom };
