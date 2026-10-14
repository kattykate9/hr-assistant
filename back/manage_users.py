"""Run inside the API container: python manage_users.py create kate"""
import argparse
import getpass
import re
from auth_accounts import init_auth, normalize_username, password_hash
from db import open_pool, close_pool, connect_db


def main():
    parser = argparse.ArgumentParser(description='Учётные записи сотрудников общего кабинета HR Assistant')
    parser.add_argument('action', choices=['create', 'reset-password', 'disable'])
    parser.add_argument('username')
    args = parser.parse_args()
    username = normalize_username(args.username)
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.@+-]{2,99}', username):
        parser.error('Логин: 3–100 символов, латинские буквы, цифры, _ . @ + -')
    encoded = None
    if args.action != 'disable':
        password = getpass.getpass('Новый пароль (минимум 12 символов): ')
        if len(password) < 12 or len(password) > 256 or not password.strip():
            parser.error('Пароль должен содержать от 12 до 256 символов')
        if password != getpass.getpass('Повторите пароль: '):
            parser.error('Пароли не совпали')
        encoded = password_hash(password)
    open_pool()
    try:
        with connect_db() as connection:
            init_auth(connection)
            existing = connection.execute('SELECT username FROM hr_auth_users WHERE username=%s FOR UPDATE', (username,)).fetchone()
            if args.action == 'create':
                if existing:
                    parser.error('Пользователь уже существует. Для смены пароля: reset-password')
                connection.execute('INSERT INTO hr_auth_users (username,password_hash) VALUES (%s,%s)', (username, encoded))
            else:
                if not existing:
                    parser.error('Пользователь не найден')
                if args.action == 'disable':
                    connection.execute('UPDATE hr_auth_users SET active=false,updated_at=now() WHERE username=%s', (username,))
                else:
                    connection.execute('UPDATE hr_auth_users SET password_hash=%s,active=true,updated_at=now() WHERE username=%s', (encoded, username))
                connection.execute('DELETE FROM hr_auth_sessions WHERE username=%s', (username,))
        print('Готово. Изменения сохранены; при сбросе пароля/отключении все сессии пользователя отозваны.')
    finally:
        close_pool()

if __name__ == '__main__':
    main()
