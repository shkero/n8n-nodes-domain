const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const nodeDir = path.join(rootDir, 'nodes');
const distNodeDir = path.join(rootDir, 'dist', 'nodes');
const assetExtensions = new Set(['.json', '.svg']);

function copyAssets(sourceDir, targetDir) {
	if (!fs.existsSync(sourceDir)) {
		return;
	}

	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);

		if (entry.isDirectory()) {
			copyAssets(sourcePath, targetPath);
			continue;
		}

		if (!assetExtensions.has(path.extname(entry.name))) {
			continue;
		}

		fs.mkdirSync(path.dirname(targetPath), { recursive: true });
		fs.copyFileSync(sourcePath, targetPath);
	}
}

copyAssets(nodeDir, distNodeDir);
