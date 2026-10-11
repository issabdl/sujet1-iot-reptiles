FROM eclipse-mosquitto:2

COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY acl passwd /mosquitto/config/

RUN chown mosquitto:mosquitto /mosquitto/config/acl /mosquitto/config/passwd \
 && chmod 0700 /mosquitto/config/acl /mosquitto/config/passwd
