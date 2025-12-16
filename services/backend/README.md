\## Run

1\) Start infra:

&nbsp;  docker compose -f ../../infra/docker-compose.yml up -d



2\) Create venv + install:

&nbsp;  python -m venv .venv

&nbsp;  source .venv/bin/activate  # windows: .venv\\Scripts\\activate

&nbsp;  pip install -e .



3\) Set env:

&nbsp;  cp ../../.env.example .env

&nbsp;  # edit .env and set ANTHROPIC\_API\_KEY

&nbsp;  export $(cat .env | xargs)  # windows use setx or your shell



4\) Start:

&nbsp;  uvicorn app.main:app --reload --port 8000



