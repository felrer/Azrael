"use strict";

// Render through the pinned native menu item, tooltip and lightning icons.
function renderAstraSpeedToggle(jsx, Menu, icons, classes, props) {
  const { selectedServiceTier, onSelectServiceTier, disabled, hidden, intl } = props;
  const mode = selectedServiceTier === "ultrafast" ? "ultrafast"
    : selectedServiceTier === "priority" || selectedServiceTier === "fast" ? "fast" : "default";
  const next = mode === "default" ? "priority" : mode === "fast" ? "ultrafast" : null;
  const message = (id, defaultMessage) => intl.formatMessage({ id, defaultMessage });
  const nextLabel = next === null
    ? message("composer.intelligencePicker.standardMode.toggle.enable.ariaLabel", "Enable standard mode")
    : next === "priority"
      ? message("composer.intelligencePicker.fastMode.toggle.enable.ariaLabel", "Enable fast mode")
      : message("azrael.speed.ultrafast.enable", "Enable ultrafast mode");
  const title = mode === "ultrafast" ? message("serviceTier.ultrafast.label", "Ultrafast")
    : mode === "fast" ? message("serviceTier.fast.label", "Fast")
      : message("serviceTier.standard.label", "Standard");
  const description = mode === "default"
    ? message("serviceTier.standard.description", "Default speed")
    : message("composer.intelligencePicker.fastMode.moreUsage.tooltip", "More usage");
  const purple = mode === "ultrafast";
  return jsx(Menu.Item, {
    "aria-label": nextLabel,
    "aria-hidden": hidden,
    "data-azrael-astra-speed": mode,
    "data-fast-mode-enabled": mode !== "default",
    "data-max-power-selection": props.maximum,
    className: classes.FastModeToggle,
    style: purple ? {
      color: "var(--color-purple)",
      backgroundColor: "color-mix(in srgb, var(--color-purple) 18%, transparent)",
    } : undefined,
    disabled,
    inert: hidden,
    onSelect(event) {
      event.preventDefault();
      if (!disabled) onSelectServiceTier(next);
    },
    tooltipSide: "top",
    tooltipText: jsx("span", {
      className: "flex flex-col text-start",
      children: [jsx("span", { children: title }), jsx("span", { className: "opacity-65", children: description })],
    }),
    variant: "unstyled",
    children: jsx("span", {
      className: classes.FastModeToggleContent,
      style: purple ? { color: "var(--color-purple)" } : undefined,
      children: jsx(mode === "default" ? icons.standard : icons.fast, { "aria-hidden": true }),
    }),
  });
}

module.exports = { renderAstraSpeedToggle };
