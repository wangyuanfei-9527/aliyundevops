// =============================================================================
// Shared Template Rendering Utility — A4 Terraform
// Renders Handlebars (.hbs) templates with given context.
// =============================================================================

import Handlebars from "handlebars";
import fs from "fs";
import path from "path";

/**
 * Compile and render a Handlebars template string with the given context.
 *
 * @param templateContent - The raw .hbs template content
 * @param context - Key-value pairs to substitute
 * @returns Rendered string
 */
export function renderTemplateString(
  templateContent: string,
  context: Record<string, string | number | boolean>,
): string {
  const compiled = Handlebars.compile(templateContent, { noEscape: true });
  return compiled(context);
}

/**
 * Load a .hbs template file, render it with context, and return the result.
 *
 * @param templatePath - Absolute path to the .hbs template file
 * @param context - Key-value pairs to substitute
 * @returns Rendered file content
 */
export function renderTemplateFile(
  templatePath: string,
  context: Record<string, string | number | boolean>,
): string {
  const content = fs.readFileSync(templatePath, "utf-8");
  return renderTemplateString(content, context);
}

/**
 * Render a .hbs template and write the result to a target file.
 * The output filename is the template filename without the .hbs extension.
 *
 * @param templatePath - Absolute path to the .hbs template file
 * @param targetDir - Directory to write the rendered file
 * @param context - Key-value pairs to substitute
 * @returns Path to the written file
 */
export function renderTemplateToFile(
  templatePath: string,
  targetDir: string,
  context: Record<string, string | number | boolean>,
): string {
  const templateBasename = path.basename(templatePath);
  // Remove .hbs extension for output filename
  const outputName = templateBasename.replace(/\.hbs$/, "");
  const outputPath = path.join(targetDir, outputName);

  const rendered = renderTemplateFile(templatePath, context);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(outputPath, rendered, "utf-8");

  return outputPath;
}
