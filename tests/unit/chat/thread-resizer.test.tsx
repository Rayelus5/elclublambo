import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadResizer } from "@/components/chat/thread-resizer";
import { clampThreadWidth, loadThreadWidth, saveThreadWidth, THREAD_MIN, THREAD_DEFAULT } from "@/lib/chat/thread-width";

beforeEach(() => localStorage.clear());

describe("thread width", () => {
  it("clamps between the minimum and what leaves the channel its minimum", () => {
    expect(clampThreadWidth(100, 1200)).toBe(THREAD_MIN);
    expect(clampThreadWidth(500, 1200)).toBe(500);
    expect(clampThreadWidth(5000, 1200)).toBe(1200 - THREAD_MIN);
  });

  it("persists per browser and falls back to the default on junk", () => {
    expect(loadThreadWidth()).toBe(THREAD_DEFAULT);
    saveThreadWidth(512);
    expect(loadThreadWidth()).toBe(512);
    localStorage.setItem("elclub:thread-width", "nope");
    expect(loadThreadWidth()).toBe(THREAD_DEFAULT);
  });
});

describe("ThreadResizer", () => {
  it("is an accessible vertical separator with the current width", () => {
    render(<ThreadResizer width={400} min={320} max={900} onChange={() => {}} />);
    const sep = screen.getByRole("separator", { name: "Redimensionar hilo" });
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuenow", "400");
    expect(sep).toHaveAttribute("aria-valuemin", "320");
    expect(sep).toHaveAttribute("aria-valuemax", "900");
  });

  it("arrow keys widen/narrow the thread (it sits on the right: left arrow widens), Home/End jump to the limits", () => {
    const onChange = vi.fn();
    render(<ThreadResizer width={400} min={320} max={900} onChange={onChange} />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(432);
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(368);
    fireEvent.keyDown(sep, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(320);
    fireEvent.keyDown(sep, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(900);
  });

  it("dragging left widens the thread by the distance moved, clamped", () => {
    const onChange = vi.fn();
    render(<ThreadResizer width={400} min={320} max={900} onChange={onChange} />);
    const sep = screen.getByRole("separator");
    fireEvent.pointerDown(sep, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 900, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(500);
    fireEvent.pointerMove(sep, { clientX: 100, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(900);
    fireEvent.pointerUp(sep, { pointerId: 1 });
    onChange.mockClear();
    fireEvent.pointerMove(sep, { clientX: 800, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
