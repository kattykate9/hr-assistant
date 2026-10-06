"""Read-only check. Does not send messages or consume bot updates."""
from candidate_messages import check_connection
if __name__ == '__main__':
    ok,detail=check_connection()
    print(('OK: ' if ok else 'Проверка не пройдена: ')+detail)
    print('Сообщения не отправлялись.')
    raise SystemExit(0 if ok else 1)
