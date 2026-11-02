"use strict";

// Transform only the served response; both prepared and pristine assets stay
// immutable. Y8r owns the existing composer scope for home and thread routes.
const TARGET = "app-initial-c014f9ee4429.js";
const ANCHOR = "(c=(0,Z8r.jsx)(a,{scope:o,value:s,children:n}),t[5]=a";
const MARKER = "/* azrael-desktop-native-image-bridge */";
const COMPONENT = `
${MARKER}
let azraelDesktopImageOverlay, azraelDesktopImageBridgeContext;
function AzraelDesktopImageBridgeHost({ children }) {
  const React = X();
  azraelDesktopImageBridgeContext ??= React.createContext(false);
  const nested = React.useContext(azraelDesktopImageBridgeContext);
  if (nested) return children;
  return (0,Z8r.jsxs)(azraelDesktopImageBridgeContext.Provider, {
    value: true,
    children: [children, (0,Z8r.jsx)(AzraelDesktopImageBridge,{})],
  });
}
function AzraelDesktopImageBridge() {
  const React = X();
  const route = ta(Ev);
  const composer = ta(Iv);
  const location = K(Dm);
  const active = location?.pathname === route.value.pathname && location.search === (route.value.search ?? "");
  const [preview, setPreview] = React.useState(null);
  React.useEffect(() => {
    setPreview(null);
    if (!active) return;
    const receive = event => {
      if (event.source !== window || event.data?.type !== "azrael-desktop-image-open") return;
      const input = event.data.image;
      if (!input || typeof input.src !== "string") return;
      let resource;
      try { resource = new URL(input.src); } catch { return; }
      if (resource.protocol !== "azrael-app:" || resource.hostname !== "resource") return;
      setPreview({ composer, route, image: {
        src: input.src,
        downloadSrc: input.src,
        attachmentSrc: input.src,
        title: typeof input.title === "string" ? input.title : "Image",
        alt: typeof input.title === "string" ? input.title : "Image",
        readOnly: true,
      } });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [active, composer, route]);
  if (!active || !preview || preview.composer !== composer || preview.route !== route) return null;
  azraelDesktopImageOverlay ??= React.lazy(() => import("./overlay-89a80bed72d0.js").then(module => ({ default: module.ImagePreviewOverlay })));
  return (0,Z8r.jsx)(React.Suspense, {
    fallback: null,
    children: (0,Z8r.jsx)(azraelDesktopImageOverlay, {
      image: preview.image,
      hideComposer: true,
      onClose: () => setPreview(null),
    }, preview.image.src),
  });
}
`;

function transform(filename, text) {
  if (String(filename).split(/[\\/]/).pop() !== TARGET) return text;
  if (typeof text !== "string") throw new TypeError("Image bridge transform requires JavaScript text");
  if (text.includes(MARKER)) throw new Error("Desktop image bridge is already applied");
  if (text.split(ANCHOR).length !== 2) throw new Error("Pinned composer scope image bridge anchor must occur exactly once");
  for (const contract of ["function Y8r(e){", "function vit(e){return mr(e,Iv", "function Tm(e){", "Z8r=i()", "Iv=z(`ComposerScope`", "Ev=z(`RouteScope`"]) {
    if (!text.includes(contract)) throw new Error("Pinned composer scope image bridge contract changed: " + contract);
  }
  const replacement = "(c=(0,Z8r.jsx)(a,{scope:o,value:s,children:(0,Z8r.jsx)(AzraelDesktopImageBridgeHost,{children:n})}),t[5]=a";
  return text.replace(ANCHOR, replacement) + COMPONENT;
}

module.exports = { transform };
