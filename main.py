from config import CONFIG


def main():
    print('Configuration values:')
    for key, value in CONFIG.items():
        print(f'  {key}: {value}')


if __name__ == '__main__':
    main()
