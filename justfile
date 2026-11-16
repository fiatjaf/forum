export PATH := "./node_modules/.bin:" + env_var('PATH')

dev:
    vite --port 5176 --strictPort

deploy:
    tsc --noEmit
    vite build
    printf '/* /index.html 200\n' > dist/_redirects
    npx wrangler pages deploy dist/ --project-name forum --commit-dirty=true
