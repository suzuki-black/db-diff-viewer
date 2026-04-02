FROM alpine:3.19

RUN apk add --no-cache openssh bash

# SSH ホスト鍵を生成
RUN ssh-keygen -A

# テスト用ユーザー作成（パスワードログイン無効・鍵認証のみ）
# adduser -D はパスワードを "!" に設定してアカウントをロックする。
# OpenSSH はロック状態のアカウントへの公開鍵認証も拒否するため、
# chpasswd -e で暗号化パスワード "*" を設定してロックを解除する。
# "*" は「パスワードなし（ログイン不可）だがロックではない」状態を示す。
RUN adduser -D -s /bin/bash sshuser && \
    echo 'sshuser:*' | chpasswd -e && \
    mkdir -p /home/sshuser/.ssh && \
    chmod 700 /home/sshuser/.ssh

# 公開鍵を配置
COPY authorized_keys /home/sshuser/.ssh/authorized_keys
RUN chmod 600 /home/sshuser/.ssh/authorized_keys && \
    chown -R sshuser:sshuser /home/sshuser/.ssh

# sshd 設定
RUN sed -i \
    -e 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' \
    -e 's/#PasswordAuthentication yes/PasswordAuthentication no/' \
    -e 's/PasswordAuthentication yes/PasswordAuthentication no/' \
    -e 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' \
    /etc/ssh/sshd_config

# AllowTcpForwarding を有効化（ポートフォワード用）
# Alpine の sshd_config には "AllowTcpForwarding no" が明示設定されており、
# OpenSSH は最初の定義を優先するため、追記ではなく sed で既存行を上書きする。
RUN sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#AllowTcpForwarding no/AllowTcpForwarding yes/' /etc/ssh/sshd_config && \
    grep -q '^AllowTcpForwarding yes' /etc/ssh/sshd_config || echo "AllowTcpForwarding yes" >> /etc/ssh/sshd_config

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D", "-e"]
