export $(shell grep -v '^#' .env | xargs)

serve:
	pnpm run dev

tunnel:  ## Open dev server as world-wide.
	# first run `ngrok config add-authtoken <ngrok token>`  - token on page 'your-autotoken', not 'tunnels->autotoken'!!!
	ngrok http 5173

update_b2_cors_rules:
	b2 bucket update --cors-rules "$$(<./b2.json)" $${B2_BUCKET_NAME}
