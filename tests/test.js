var b = require('../lib/braggadocio');

var URL = 'http://swagger.sprav-address-exceptions.hadar.backa.dev.yandex.net/api';
b.createClientFromUrl(URL, {logFn: console.log.bind(console), timeout: 1e4})
    .done(
        function (client) {
            client.ops.getAddressExceptions({offset: 10, limit: 30})
                .done(console.log.bind(console));
            //client.ops.getAddressException({exception_id: 0})
                //.always(console.log.bind(console)).done();
        },
        function (err) {
            consone.err(err);
        }
    );
