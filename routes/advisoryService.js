var express = require('express');

var AdvisoryServiceServices = require('../services/advisoryService');

var routes = AdvisoryService => {
    var advisoryServiceRouter = express.Router();

    advisoryServiceRouter.route('/calculate')
        .post((req, res) => {
            var advisoryService = req.body;            
            AdvisoryServiceServices.calculate(advisoryService)
                .then(advisoryService => {
                    console.log(advisoryService);
                    res.status(200).send(advisoryService);
                })
                .catch(err => {
                    res.status(500).send(err);
                });
        });

    return advisoryServiceRouter;
};

module.exports = routes;