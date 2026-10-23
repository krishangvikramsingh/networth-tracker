// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DataTable, Field, Kpi, Modal, MoneyInput, Segmented, Tabs, Badge } from "../../src/web/ui";

afterEach(cleanup);

interface Row { id: string; name: string; value: number }
const rows: Row[] = [{ id: "a", name: "Gold", value: 20 }, { id: "b", name: "Bonds", value: 60 }, { id: "c", name: "Equity", value: 150 }];
const cols = [
  { key: "n", label: "Holding", render: (r: Row) => r.name, sort: (r: Row) => r.name },
  { key: "v", label: "Value", right: true, render: (r: Row) => String(r.value), sort: (r: Row) => r.value },
];
const bodyNames = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("DataTable", () => {
  it("sorts by a column, flips on a second click, and says so to assistive tech", async () => {
    render(<DataTable rows={rows} cols={cols} />);
    await userEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(bodyNames()).toEqual(["Gold", "Bonds", "Equity"]);
    expect(screen.getByRole("columnheader", { name: /Value/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /Value/ }));
    expect(bodyNames()).toEqual(["Equity", "Bonds", "Gold"]);
    expect(screen.getByRole("columnheader", { name: /Value/ })).toHaveAttribute("aria-sort", "descending");
  });
  it("sorts missing values last, whichever the direction", async () => {
    const withNull = [...rows, { id: "d", name: "Cash", value: null as unknown as number }];
    const c = [cols[0], { ...cols[1], sort: (r: Row) => r.value as number | null }];
    render(<DataTable rows={withNull} cols={c} />);
    await userEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(bodyNames().at(-1)).toBe("Cash");
    await userEvent.click(screen.getByRole("button", { name: /Value/ }));
    expect(bodyNames().at(-1)).toBe("Cash");
  });
  it("filters by search text and reports the count", async () => {
    render(<DataTable rows={rows} cols={cols} search={(r) => r.name} />);
    await userEvent.type(screen.getByLabelText("Search table"), "bo");
    expect(bodyNames()).toEqual(["Bonds"]);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });
  it("shows the empty state, and right-aligns numeric columns", async () => {
    render(<DataTable rows={[]} cols={cols} empty={<p>Nothing recorded</p>} />);
    expect(screen.getByText("Nothing recorded")).toBeInTheDocument();
    cleanup(); render(<DataTable rows={rows} cols={cols} />);
    expect(within(screen.getAllByRole("row")[1]).getAllByRole("cell")[1]).toHaveClass("r", "num");
  });
  it("pages long lists", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, name: `Item ${i}`, value: i }));
    render(<DataTable rows={many} cols={cols} pageSize={3} />);
    expect(bodyNames()).toEqual(["Item 0", "Item 1", "Item 2"]);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" })); await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(bodyNames()).toEqual(["Item 6"]); expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
  it("makes a row clickable only when asked", async () => {
    const onRow = vi.fn(); render(<DataTable rows={rows} cols={cols} onRow={onRow} />);
    await userEvent.click(screen.getByText("Bonds")); expect(onRow).toHaveBeenCalledWith(rows[1]);
  });
});

function Host({ onClose = () => {} }: { onClose?: () => void }) {
  return <div><button type="button">opener</button><Modal title="Edit holding" onClose={onClose} footer={<button type="button">Save</button>}><input aria-label="Name" /><input aria-label="Value" /></Modal></div>;
}
function Toggle() { const [o, s] = useState(false); return <><button type="button" onClick={() => s(true)}>open</button>{o && <Modal title="T" onClose={() => s(false)}><p>hi</p></Modal>}</>; }
describe("Modal", () => {
  it("is a labelled dialog and puts focus on its first field", () => {
    render(<Host />);
    const d = screen.getByRole("dialog", { name: "Edit holding" });
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });
  it("closes on Escape and on a click on the backdrop, but not on a click inside", async () => {
    const onClose = vi.fn(); const { container } = render(<Host onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Value")); expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}"); expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(container.querySelector(".overlay")!); expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("keeps Tab inside the dialog, wrapping from the last control to the first and back", async () => {
    render(<Host />);
    const first = screen.getByRole("button", { name: "Close" }), last = screen.getByRole("button", { name: "Save" });
    last.focus(); await userEvent.tab(); expect(first).toHaveFocus();
    await userEvent.tab({ shift: true }); expect(last).toHaveFocus();
  });
  it("returns focus to whatever opened it, and releases the page scroll lock", () => {
    render(<Toggle />);
    const opener = screen.getByRole("button", { name: "open" }); opener.focus(); fireEvent.click(opener);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(opener).toHaveFocus(); expect(document.body.style.overflow).toBe("");
  });
});

describe("Field", () => {
  it("ties the label to its control, and marks an invalid one with a spoken error", () => {
    render(<Field label="Current value" error="Enter an amount."><input /></Field>);
    const input = screen.getByLabelText("Current value");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount.");
  });
  it("shows a hint when there is no error, and neither marks valid fields invalid", () => {
    render(<Field label="Name" hint="As on the statement"><input /></Field>);
    expect(screen.getByText("As on the statement")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});

/** MoneyInput is controlled, so test it the way a form uses it: with the value held in state. */
function MoneyHost({ onChange }: { onChange: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(null);
  return <MoneyInput value={v} onChange={(x) => { setV(x); onChange(x); }} />;
}
describe("MoneyInput", () => {
  it("understands lakh and crore shorthand and reports whole paise", async () => {
    const onChange = vi.fn(); render(<MoneyHost onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox"), "1.5cr");
    expect(onChange).toHaveBeenLastCalledWith(1_50_00_000 * 100);
    expect(screen.getByText(/₹1,50,00,000/)).toBeInTheDocument();
  });
  it("says so when the text is not an amount, and reports no value", async () => {
    const onChange = vi.fn(); render(<MoneyHost onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox"), "abc");
    expect(screen.getByText("Not a valid amount")).toBeInTheDocument(); expect(onChange).toHaveBeenLastCalledWith(null);
  });
  it("shows an existing value in rupees", () => {
    render(<MoneyInput value={25_00_000_00} onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("2500000");
  });
});

describe("Kpi", () => {
  it("is a button only when it has somewhere to go", async () => {
    const go = vi.fn(); const { rerender } = render(<Kpi label="Gross assets" value="₹8.63 Cr" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Kpi label="Gross assets" value="₹8.63 Cr" onClick={go} />);
    await userEvent.click(screen.getByRole("button")); expect(go).toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveAccessibleName(expect.stringContaining("Gross assets"));
  });
  it("prints 'Awaiting data' for an unknown, never a number, and never colours it as good or bad", () => {
    render(<Kpi label="Net worth" await value="₹0" tone="good" />);
    const v = screen.getByText("Awaiting data"); expect(screen.queryByText("₹0")).toBeNull();
    expect(v.getAttribute("style") ?? "").not.toContain("color");
  });
  it("colours a known change by its sign", () => {
    render(<Kpi label="Change" value="-2%" tone="crit" />);
    expect(screen.getByText("-2%").getAttribute("style")).toContain("var(--crit)");
  });
});

describe("Segmented and Tabs", () => {
  it("marks the chosen option pressed and reports the change", async () => {
    const on = vi.fn(); render(<Segmented label="Denominator" value="a" onChange={on} options={[{ id: "a", label: "Gross" }, { id: "b", label: "Investable" }]} />);
    expect(screen.getByRole("button", { name: "Gross" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Investable" })); expect(on).toHaveBeenCalledWith("b");
    expect(screen.getByRole("group", { name: "Denominator" })).toBeInTheDocument();
  });
  it("selects a tab and shows its count", async () => {
    const on = vi.fn(); render(<Tabs value="open" onChange={on} tabs={[{ id: "open", label: "Open", count: 3 }, { id: "done", label: "Done" }]} />);
    expect(screen.getByRole("tab", { name: /Open/ })).toHaveAttribute("aria-selected", "true"); expect(screen.getByText(/· 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Done" })); expect(on).toHaveBeenCalledWith("done");
  });
  it("Badge renders its tone class", () => { render(<Badge tone="warn">pending</Badge>); expect(screen.getByText("pending")).toHaveClass("badge", "warn"); });
});
