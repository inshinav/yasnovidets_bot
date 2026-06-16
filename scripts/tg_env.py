"""Загрузка TG_BOT_TOKEN из gitignored .env, чтобы секрет не приходилось
передавать инлайном в команде (это утекает в историю shell / транскрипт Claude
и срабатывает на block-secrets-хук).

Порядок (ПРИОРИТЕТ ФАЙЛА проекта над глобальной переменной): сначала читаем
.env / .env.local в корне проекта; если там есть TG_BOT_TOKEN — он ПОБЕЖДАЕТ и
перезаписывает os.environ (чтобы стухшая глобальная переменная, напр. от другого
бота, не перебивала проектный токен). Если файла нет — берём из окружения."""
import os


def ensure_token_env():
    """Гарантирует os.environ['TG_BOT_TOKEN']; возвращает токен либо None.
    Проектный .env приоритетнее уже выставленной переменной окружения."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for name in (".env", ".env.local"):
        path = os.path.join(root, name)
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    if key.strip() == "TG_BOT_TOKEN":
                        token = value.strip().strip('"').strip("'")
                        if token:
                            os.environ["TG_BOT_TOKEN"] = token  # файл проекта побеждает
                            return token
        except FileNotFoundError:
            continue
    return os.environ.get("TG_BOT_TOKEN")
