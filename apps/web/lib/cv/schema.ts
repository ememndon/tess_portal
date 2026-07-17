import { z } from "zod";

/**
 * The strict profile schema. An uploaded CV is structured into this by
 * the LLM, then the user reviews and confirms it. Every downstream
 * feature, tailoring, cover letters, form answers, treats the confirmed
 * profile as the ONLY source of truth: a tailored CV may never contain
 * a claim absent from here.
 */

export const experienceSchema = z.object({
  company: z.string().max(200).default(""),
  role: z.string().max(200).default(""),
  location: z.string().max(160).default(""),
  start: z.string().max(40).default(""),
  end: z.string().max(40).default(""),
  current: z.boolean().default(false),
  bullets: z.array(z.string().max(600)).default([]),
});

export const educationSchema = z.object({
  institution: z.string().max(200).default(""),
  degree: z.string().max(200).default(""),
  field: z.string().max(200).default(""),
  start: z.string().max(40).default(""),
  end: z.string().max(40).default(""),
});

export const projectSchema = z.object({
  name: z.string().max(200).default(""),
  description: z.string().max(1000).default(""),
  url: z.string().max(500).default(""),
  tech: z.array(z.string().max(60)).default([]),
});

export const certificationSchema = z.object({
  name: z.string().max(200).default(""),
  issuer: z.string().max(200).default(""),
  year: z.string().max(20).default(""),
});

export const languageSchema = z.object({
  name: z.string().max(80).default(""),
  level: z.string().max(60).default(""),
});

export const profileSchema = z.object({
  name: z.string().max(160).default(""),
  headline: z.string().max(200).default(""),
  email: z.string().max(200).default(""),
  phone: z.string().max(60).default(""),
  location: z.string().max(160).default(""),
  links: z.array(z.string().max(400)).default([]),
  summary: z.string().max(3000).default(""),
  skills: z.array(z.string().max(80)).default([]),
  experience: z.array(experienceSchema).default([]),
  education: z.array(educationSchema).default([]),
  projects: z.array(projectSchema).default([]),
  certifications: z.array(certificationSchema).default([]),
  languages: z.array(languageSchema).default([]),
  /** the user's stated work style, feeds culture-fit scoring */
  workStyle: z.string().max(600).default(""),
});

export type Profile = z.infer<typeof profileSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type ProfileProject = z.infer<typeof projectSchema>;

export const EMPTY_PROFILE: Profile = profileSchema.parse({});

/**
 * The flat set of confirmed claim tokens a tailored document may draw
 * on: skills, tech from projects, and the words of roles and companies.
 * Used to enforce the no-unconfirmed-claim constraint.
 */
export function confirmedSkillSet(profile: Profile): Set<string> {
  const set = new Set<string>();
  const add = (s: string) => {
    const norm = s.trim().toLowerCase();
    if (norm) set.add(norm);
  };
  profile.skills.forEach(add);
  profile.projects.forEach((p) => p.tech.forEach(add));
  profile.certifications.forEach((c) => add(c.name));
  profile.languages.forEach((l) => add(l.name));
  return set;
}
