var express = require('express'),
    multer = require('multer');

var LogService = require("../services/log")();
var AdvisoryServiceServices = require('../services/advisoryService');

var upload = multer({
    dest: '..uploads/'
});

var routes = AdvisoryService => {
    var advisoryServiceRouter = express.Router();

    advisoryServiceRouter.route('/')
        /**
         * POST - Create advisory Service.
         */
        .post((req, res) => {
            AdvisoryServiceServices.createAdvisoryService(req.body)
                .then(advisoryService => {
                    LogService.log('AdvisoryServiceRouter', 'createAdvisoryService', 'info', 'info');
                    res.status(200).send(advisoryService);
                })
                .catch(err => {                    
                    LogService.log('AdvisoryServiceRouter', 'createAdvisoryService', 'error', 'err', { err: err });
                    res.status(500).send(err);
                });
        });

    advisoryServiceRouter.route('/:advisoryServiceId')
        .get((req, res) => {
            AdvisoryServiceServices.getAdvisoryServiceById(req.params.advisoryServiceId)
                .then(advisoryService => res.status(200).send(advisoryService))
                .catch(err => res.status(500).send(err));
        });

    advisoryServiceRouter.route('/filter')
        .post((req, res) => {
            AdvisoryServiceServices.filterByParams(req.body)
                .then(advisoryServices => res.status(200).send(advisoryServices))
                .catch(err => res.status(500).send());
        });

    /**
     * POST - Calculate service price.
     */
    advisoryServiceRouter.route('/calculate')
        .post((req, res) => {
            var advisoryService = req.body;
            AdvisoryServiceServices.calculate(advisoryService)
                .then(advisoryService => {
                    res.status(200).send(advisoryService);
                })
                .catch(err => {
                    res.status(500).send(err);
                });
        });

    /**
     * POST - Validate Service.
     */
    advisoryServiceRouter.route('/validate')
        .post((req, res) => {
            var advisoryService = req.body;
            AdvisoryServiceServices.validate(advisoryService)
                .then(advisoryService => {
                    res.status(200).send(advisoryService);
                })
                .catch(err => {
                    res.status(500).send(err);
                });
        });

    /**
     * GET - Retrieve service by student Id.
     */
    advisoryServiceRouter.route('/get-by-student/:studentId')
        .get((req, res) => {
            AdvisoryServiceServices.getAllByStudentId(req.params.studentId)
                .then(services => {
                    res.status(200).send(services);
                })
                .catch(err => res.status(500).send(err));
        });

    advisoryServiceRouter.get('/available-services/:teacherId', (req, res) => {
        AdvisoryServiceServices.getAvailableServices(req.params.teacherId)
            .then(result => res.status(200).send(result))
            .catch(err => res.status(500).send(err));
    });

    /**
     * POST - Save file for advisory service.
     */
    advisoryServiceRouter.post('/files/:advisoryServiceId', upload.single('file'), (req, res) => {
        var file = req.file;
        AdvisoryServiceServices.uploadFile(req.params.advisoryServiceId, file)
            .then(() => {
                res.status(200).send();
            })
            .catch(err => {
                console.log(err);
                res.status(500).send(err);
            });
    });

    advisoryServiceRouter.post('/assign/:advisoryServiceId/:teacherId', (req, res) => {
        AdvisoryServiceServices.assign(req.params.advisoryServiceId, req.params.teacherId)
            .then(response => res.status(200).send(response))
            .catch(err => res.status(500).send(err));
    });

    return advisoryServiceRouter;
};

module.exports = routes;
