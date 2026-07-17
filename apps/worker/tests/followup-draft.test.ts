import { describe, expect, it } from "vitest";
import { followupDraft } from "../src/inbox";

/**
 * The sequencer's pre-filled follow-up body (pure). It personalizes the
 * greeting and the role line, and never invents details it wasn't given.
 */

describe("followupDraft", () => {
  it("uses the contact's first name and the role + company", () => {
    const { subject, body } = followupDraft({
      contactName: "Dana Okoro",
      jobTitle: "Full Stack Developer",
      jobCompany: "Arden Labs",
      userName: "Sam Rivera",
    });
    expect(subject).toBe("Following up on the Full Stack Developer role at Arden Labs");
    expect(body).toContain("Hi Dana,");
    expect(body).toContain("Full Stack Developer role at Arden Labs");
    expect(body.trimEnd().endsWith("Sam Rivera")).toBe(true);
  });

  it("falls back to a generic greeting and subject when data is missing", () => {
    const { subject, body } = followupDraft({
      contactName: null,
      jobTitle: null,
      jobCompany: null,
      userName: "",
    });
    expect(subject).toBe("Following up");
    expect(body).toContain("Hi there,");
    // no role clause when there is no job
    expect(body).not.toContain("the  role");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("null");
  });

  it("omits the company when only a title is known", () => {
    const { subject, body } = followupDraft({
      contactName: "Lee",
      jobTitle: "Data Engineer",
      jobCompany: null,
      userName: "Pat",
    });
    expect(subject).toBe("Following up on the Data Engineer role");
    expect(body).toContain("about the Data Engineer role.");
  });
});
