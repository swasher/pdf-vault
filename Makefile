serve:
	pnpm run dev

tunnel:  ## Open dev server as world-wide.
	# first run `ngrok config add-authtoken <ngrok token>`  - token on page 'your-autotoken', not 'tunnels->autotoken'!!!
	ngrok http 5173
