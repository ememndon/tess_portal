import { describe, expect, it } from "vitest";
import { formatSalaryNative } from "../lib/server/money";

/**
 * Salaries must read in the currency the employer quoted, never converted.
 * A UK role showing "€76k" instead of "£65k–85k" misrepresents the offer.
 * The cases below are drawn from real rows in the jobs table.
 */

const job = (over: Partial<Parameters<typeof formatSalaryNative>[0]>) => ({
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  ...over,
});

describe("formatSalaryNative", () => {
  it("keeps a UK salary in pounds, symbol once across the range", () => {
    expect(
      formatSalaryNative(job({ salaryMin: "65000", salaryMax: "85000", salaryCurrency: "GBP", salaryPeriod: "year" })),
    ).toBe("£65k–85k/yr");
  });

  it("renders a single figure when min and max agree or only one exists", () => {
    expect(formatSalaryNative(job({ salaryMin: "90000", salaryMax: "90000", salaryCurrency: "EUR", salaryPeriod: "year" }))).toBe("€90k/yr");
    expect(formatSalaryNative(job({ salaryMax: "120000", salaryCurrency: "USD", salaryPeriod: "year" }))).toBe("$120k/yr");
  });

  it("does not compact small figures like an hourly rate", () => {
    expect(formatSalaryNative(job({ salaryMin: "45", salaryMax: "60", salaryCurrency: "NZD", salaryPeriod: "hour" }))).toBe("NZ$45–60/hr");
  });

  it("never rounds a monthly salary into a misleading 'k'", () => {
    // a real NL row: 3500-5000/mo must not read "€4k–5k"
    expect(
      formatSalaryNative(job({ salaryMin: "3500", salaryMax: "5000", salaryCurrency: "EUR", salaryPeriod: "month" })),
    ).toBe("€3,500–5,000/mo");
  });

  it("picks one unit for the whole range, from the larger figure", () => {
    expect(
      formatSalaryNative(job({ salaryMin: "9000", salaryMax: "12000", salaryCurrency: "GBP", salaryPeriod: "year" })),
    ).toBe("£9k–12k/yr");
  });

  it("leaves a NZ job quoted in USD as USD", () => {
    expect(
      formatSalaryNative(job({ salaryMin: "296300", salaryMax: "423900", salaryCurrency: "USD", salaryPeriod: "year" })),
    ).toBe("$296k–424k/yr");
  });

  it("falls back to the currency code when there is no symbol", () => {
    expect(formatSalaryNative(job({ salaryMin: "30000", salaryCurrency: "AED", salaryPeriod: "month" }))).toBe("AED 30k/mo");
  });

  it("returns null when there is nothing to format", () => {
    expect(formatSalaryNative(job({ salaryCurrency: "GBP" }))).toBeNull();
    expect(formatSalaryNative(job({ salaryMin: "65000" }))).toBeNull();
  });
});
