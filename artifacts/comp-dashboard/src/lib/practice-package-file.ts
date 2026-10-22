export const MAX_PRACTICE_PACKAGE_BYTES = 10 * 1024 * 1024;

export async function readPracticePackageFile(file: Pick<File, "size" | "text">): Promise<unknown> {
  if (!file.size) throw new Error("Choose a non-empty package exported by Practice Converter.");
  if (file.size > MAX_PRACTICE_PACKAGE_BYTES)
    throw new Error("The Practice package is larger than 10 MB. Export a smaller report range from Practice Converter.");
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("The selected file is not valid JSON. Choose the package exported by Practice Converter.");
  }
}
