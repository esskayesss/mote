import { gsap } from "gsap";

export const pressable = (node: HTMLElement) => {
  const animateTo = (properties: gsap.TweenVars) =>
    gsap.to(node, {
      duration: 0.18,
      ease: "power2.out",
      overwrite: "auto",
      ...properties
    });

  const handlePointerEnter = () => animateTo({ y: -1, scale: 1.01 });
  const handlePointerLeave = () => animateTo({ y: 0, scale: 1 });
  const handlePointerDown = () =>
    animateTo({ y: 0, scale: 0.97, duration: 0.12, ease: "power2.inOut" });
  const handlePointerUp = () => animateTo({ y: -1, scale: 1.01 });

  node.addEventListener("pointerenter", handlePointerEnter);
  node.addEventListener("pointerleave", handlePointerLeave);
  node.addEventListener("pointerdown", handlePointerDown);
  node.addEventListener("pointerup", handlePointerUp);
  node.addEventListener("pointercancel", handlePointerLeave);
  node.addEventListener("focus", handlePointerEnter);
  node.addEventListener("blur", handlePointerLeave);

  return {
    destroy() {
      gsap.killTweensOf(node);
      node.removeEventListener("pointerenter", handlePointerEnter);
      node.removeEventListener("pointerleave", handlePointerLeave);
      node.removeEventListener("pointerdown", handlePointerDown);
      node.removeEventListener("pointerup", handlePointerUp);
      node.removeEventListener("pointercancel", handlePointerLeave);
      node.removeEventListener("focus", handlePointerEnter);
      node.removeEventListener("blur", handlePointerLeave);
    }
  };
};
