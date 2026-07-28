const requiredPackages = ["pg", "zod"];

for (const packageName of requiredPackages) {
  await import(packageName);
}

console.log(`Runtime dependencies OK: ${requiredPackages.join(", ")}`);
