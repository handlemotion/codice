/**
 * A person's name as the dashboard shows it, after Transitive's `memberDisplayName`: their name,
 * or without one (an email-code sign-up, an invitation) the email's local part in words:
 * "maria.lopez@" reads "Maria Lopez".
 */
export function displayName(person: { name?: string | null; email: string }) {
  const name = person.name?.trim();
  if (name) return name;
  const words = (person.email.split("@", 1)[0] ?? "").split(/[._+-]+/u).filter(Boolean);
  return words.length > 0
    ? words.map((word) => word.charAt(0).toLocaleUpperCase("es") + word.slice(1)).join(" ")
    : person.email;
}
