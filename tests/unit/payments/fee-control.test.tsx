import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FeeControl } from "@/components/payments/fee-control";

function setup(value: number, minBps = 100) {
  const onChange = vi.fn();
  render(<FeeControl minBps={minBps} value={value} onChange={onChange} />);
  return onChange;
}

describe("FeeControl", () => {
  it("shows the minimum as a locked floor", () => {
    setup(100);
    expect(screen.getByText(/Mínimo 1 %/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bajar comisión/ })).toBeDisabled();
  });

  it("raises in 0,5 % steps", async () => {
    const onChange = setup(100);
    await userEvent.click(screen.getByRole("button", { name: /Subir comisión/ }));
    expect(onChange).toHaveBeenCalledWith(150);
  });

  it("never goes below the floor or above 50 %", async () => {
    const onChange = setup(5000);
    expect(screen.getByRole("button", { name: /Subir comisión/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Bajar comisión/ }));
    expect(onChange).toHaveBeenCalledWith(4950);
  });

  it("accepts a typed percent and ignores values under the floor", async () => {
    const onChange = setup(100);
    const input = screen.getByLabelText(/Comisión \(%\)/);
    await userEvent.clear(input);
    await userEvent.type(input, "2,5");
    expect(onChange).toHaveBeenLastCalledWith(250);
    onChange.mockClear();
    await userEvent.clear(input);
    await userEvent.type(input, "0,5");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("entre 1 % y 50 %");
  });

  it("with a zero floor says there is no minimum", () => {
    setup(0, 0);
    expect(screen.getByText(/Sin mínimo/)).toBeInTheDocument();
  });
});
