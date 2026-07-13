/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')
const Mocha = require('mocha')

const mocha = new Mocha()

function addTests (directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      addTests(file)
    } else if (entry.name.endsWith('.test.ts')) {
      mocha.addFile(file)
    }
  }
}

const testDirectories = process.argv.slice(2)
const roots = testDirectories.length === 0 ? [__dirname] : testDirectories.map((directory) => path.resolve(directory))
for (const root of roots) addTests(root)
mocha.loadFiles()
mocha.run((failures) => {
  process.exitCode = failures === 0 ? 0 : 1
})
