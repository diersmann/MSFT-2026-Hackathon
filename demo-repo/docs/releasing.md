# Releasing

1. Bump the version in `package.json`.
2. Tag the commit: `git tag v$(node -p "require('./package.json').version")`.
3. Push tags: `git push --tags`.
