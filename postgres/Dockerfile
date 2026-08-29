FROM postgres:18

# openssl is needed by init-tls.sh to generate the self-signed server certificate.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY init-tls.sh /docker-entrypoint-initdb.d/init-tls.sh
RUN chmod +x /docker-entrypoint-initdb.d/init-tls.sh
