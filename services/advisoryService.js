var uuidV4 = require('uuid/v4');
var Promise = require('promise');
var moment = require('moment');
var md5 = require('md5');
var config = require('../config');
var NodeGeocoder = require('node-geocoder');

/* Models */
var AdvisoryService = require('../models/advisoryService');

/* Enums */
var MailType = require('../models/enum/mailType');
var TeacheState = require('../models/enum/teacherState');
var SessionState = require('../models/enum/sessionState');
var AdvisoryServiceType = require('../models/enum/advisoryServiceType');
var AdvisoryServiceState = require('../models/enum/advisoryServiceState');

/* Services */
var NotificationServices = require('../services/notification');
var CostConfigServices = require('../services/costConfig');
var ScheduleServices = require('../services/schedule');
var StudentServices = require('../services/student');
var TeacherServices = require('../services/teacher');
var CourseServices = require('../services/course');
var UtilsServices = require('../services/utils');
var LogService = require("../services/log")();
var SQSServices = require('../services/sqs');
var S3Services = require('../services/s3');
var geocoder = NodeGeocoder(config.geocoderOptions);
var AdvisoryServiceServices = {};

/**
 * Create advisory Service
 */
AdvisoryServiceServices.createAdvisoryService = advisoryService => {
    return Promise.all([
        AdvisoryServiceServices.validate(advisoryService),
        StudentServices.getStudentById(advisoryService.studentId),
        geocoder.geocode(`${advisoryService.city.name}, ${advisoryService.address}`),
        AdvisoryServiceServices.calculate(advisoryService)
    ])
        .then(values => {
            var student = values[1];
            var geoInfo = values[2][0];
            advisoryService = values[3];

            return new Promise((resolve, reject) => {
                advisoryService.state = AdvisoryServiceState.CREATED.value;
                advisoryService.id = uuidV4();
                advisoryService.paid = false;
                advisoryService.course = advisoryService.type === AdvisoryServiceType.TUTOR.value ? CourseServices.getTutorCourse() : advisoryService.course;
                advisoryService.courseId = advisoryService.course.id;
                advisoryService.sessions = advisoryService.sessions.map((session, index) => {
                    var startTime = session.startTime.split(':');
                    var startDate = moment(session.startDate);
                    startDate.set({ hour: parseInt(startTime[0]), minute: parseInt(startTime[1]) });

                    var endDate = moment(startDate);
                    endDate.add(session.duration, 'm');

                    return {
                        id: uuidV4(),
                        startDate: session.startDate,
                        startTime: session.startTime,
                        endTime: endDate.format('HH:mm'),
                        duration: session.duration,
                        dayOfWeek: new Date(session.startDate).getDay(),
                        state: SessionState.PENDING.value,
                        realDuration: 0
                    };
                });
                advisoryService.geoInfo = {
                    city: geoInfo.city,
                    country: geoInfo.country,
                    countryCode: geoInfo.countryCode,
                    zipcode: geoInfo.zipcode,
                    formattedAddress: geoInfo.formattedAddress,
                    latitude: geoInfo.latitude,
                    longitude: geoInfo.longitude,
                    neighborhood: geoInfo.extra.neighborhood
                };
                AdvisoryService.create(advisoryService, function (err, newAdvisoryService) {
                    if (err) {
                        LogService.log('AdvisoryService', 'createAdvisoryService', 'error', 'err', newAdvisoryService);
                        reject(err);
                    }
                    else {
                        var sqsAttributes = {
                            MailType: { DataType: 'String', StringValue: MailType.SERVICE_CREATED.key },
                            Mail: { DataType: 'String', StringValue: student.email }
                        };
                        SQSServices.sendMessage(config.queues.mailQueue, JSON.stringify({ student: student, advisoryService: newAdvisoryService }), null, sqsAttributes);
                        AdvisoryServiceServices.sendNotification(newAdvisoryService);
                        LogService.log('AdvisoryService', 'createAdvisoryService', 'info', 'info', {});
                        resolve(newAdvisoryService);
                    }
                });
            });
        });
};

/**
 * Get Student By Id
 */
AdvisoryServiceServices.getAdvisoryServiceById = advisoryServiceId => {
    return new Promise((resolve, reject) => {
        AdvisoryService.get({ id: advisoryServiceId }, (err, advisoryService) => {
            if (err || advisoryService === undefined) {
                reject('Advisory Service not found');
            }
            else {
                resolve(advisoryService);
            }
        });
    });
};

/**
 * Get multiple Advisry Services that match with the params
 */
AdvisoryServiceServices.filterByParams = params => {
    return new Promise((resolve, reject) => {
        AdvisoryService.scan(params, function (err, advisoryServices) {
            if (err) reject(err);
            else {
                resolve(advisoryServices);
            }
        });
    });
};

/**
 * Update advisory Service
 */
AdvisoryServiceServices.updateAdvisoryService = (advisoryServiceId, advisoryServiceUpdated) => {
    return AdvisoryServiceServices.getAdvisoryServiceById(advisoryServiceId)
        .then(advisoryService => {
            return new Promise((resolve, reject) => {
                advisoryService = new AdvisoryService(advisoryServiceUpdated);
                advisoryService.save(err => {
                    if (err) {
                        reject(err)
                    }
                    else {
                        resolve(advisoryService)
                    }
                });
            });
        });
};

/**
 * Calculate advisory Service cost
 */
AdvisoryServiceServices.calculate = advisoryService => {
    return new Promise((resolve, reject) => {
        var cost = {};
        var h = 0;

        var costParams = {
            advisoryServiceType: advisoryService.type,
            numStudents: advisoryService.numStudents
        };

        var tutorFunction = (L, M, N, D, O, G, F, E, h) => {
            return ((L * h + M + (N * h + O) * (advisoryService.numStudents - 1)) / D * h + E) / F * G * 4
        };

        var costFunction = (L, M, A, D, C, G, F, E, h) => {
            return ((L * h + M + (A - C * (h - 8) / 2) / D) * 2 + E) / F * G / 2;
        };

        if (advisoryService.type === 1) {
            if (advisoryService.numStudents === undefined || advisoryService.numStudents <= 0 ||
                advisoryService.sessionsPerWeek === undefined || advisoryService.sessionsPerWeek <= 0 ||
                advisoryService.months === undefined || advisoryService.months <= 0) {
                reject('Datos insuficientes para calcular precio');
            }
            CostConfigServices.getCostConfigById('eb1f04cd-5991-4350-b050-4a435f516b47')
                .then(costConfig => {
                    costConfig = costConfig.config;
                    costConfig.E = 600 * 1.19;
                    costConfig.F = 1 - 0.0299 * 1.19;
                    h = 2 * advisoryService.sessionsPerWeek;
                    cost.costPerMonth = tutorFunction(costConfig.L, costConfig.M, costConfig.N, costConfig.D, costConfig.O, costConfig.G, costConfig.F, costConfig.E, h)
                    cost.costPerMonth = UtilsServices.ceil10(cost.costPerMonth, 2);
                    cost.total = cost.costPerMonth * advisoryService.months;

                    advisoryService.cost = cost;
                    resolve(advisoryService);
                });
        }
        else if (advisoryService.type === 2) {
            if (advisoryService.timePerSession === undefined || advisoryService.timePerSession <= 0 ||
                advisoryService.numStudents === undefined || advisoryService.numStudents <= 0 ||
                advisoryService.numSessions === undefined || advisoryService.numSessions <= 0 ||
                advisoryService.course === undefined || advisoryService.course.difficulty === undefined) {
                reject('Datos insuficientes para calcular precio');
            }
            h = advisoryService.timePerSession * advisoryService.numSessions;
            costParams.courseType = advisoryService.course.difficulty;
            if (advisoryService.course.difficulty === 'Regular') {
                if (h < 8) {
                    costParams.greaterThanLimit = 0;
                }
                else {
                    costParams.greaterThanLimit = 1;
                }
            }
            else if (advisoryService.course.difficulty === 'Especializado') {
                if (h < 8) {
                    costParams.greaterThanLimit = 0;
                }
                else {
                    costParams.greaterThanLimit = 1;
                }
            }

            CostConfigServices.getCostConfig(costParams.advisoryServiceType, costParams.courseType, costParams.greaterThanLimit, costParams.numStudents)
                .then(costConfig => {
                    costConfig = costConfig.config;
                    costConfig.E = 600 * 1.19;
                    costConfig.F = 1 - 0.0299 * 1.19;

                    cost.costPerHour = costFunction(costConfig.L, costConfig.M, costConfig.A, costConfig.D, costConfig.C, costConfig.G, costConfig.F, costConfig.E, h)
                    cost.costPerHour = UtilsServices.ceil10(cost.costPerHour, 2);
                    cost.total = cost.costPerHour * h;

                    advisoryService.cost = cost;
                    resolve(advisoryService);
                });
        }
        else {
            reject('No es posible calcular el valor a este tipo de servicio.');
        }

    });
};

/**
 * Validate the data into advisory service.
 */
AdvisoryServiceServices.validate = advisoryService => {
    return new Promise((resolve, reject) => {
        var today = new Date();
        today.setHours(0, 0, 0, 0);

        //Validaciones generales
        if (!advisoryService.description) {
            reject('La descripción no puede estar vacia.');
        } else if (advisoryService.sessions.length <= 0) {
            reject('Las sesiones no pueden estar vacias.');
        } else if (!advisoryService.address) {
            reject('La dirección no puede estar vacia.');
        } else if (!advisoryService.city) {
            reject('La ciudad no puede estar vacia.');
        }

        //Validaciones para las sesiones
        advisoryService.sessions.forEach((session, index) => {
            var startTime = session.startTime.split(':');
            if (new Date(session.startDate) < today) {
                reject('La fecha de inicio de una sesión no puede ser menor a hoy');
            }
            else if (!(6 <= parseInt(startTime[0]) && parseInt(startTime[0]) <= 20)) {
                console.log(session);
                reject(`La hora de inicio de las sesiones debe ser de ${config.schedule.startTimeLimit.string} a ${config.schedule.endTimeLimit.string} y la sesión del ${session.startDateToShow} esta por fuera de este rango.`);
            }
        });

        //Validaciones por tipo de servicio
        if (advisoryService.type === AdvisoryServiceType.TUTOR.value) {
            if (!(1 <= advisoryService.months && advisoryService.months <= 12)) {
                reject('La cantidad de meses debe estar entre 1 y 12.');
            }
            else if (!(2 <= advisoryService.sessionsPerWeek && advisoryService.sessionsPerWeek <= 5)) {
                reject('La cantidad de sesiones por semana debe estar entre 2 y 5.');
            }
            else if (new Date(advisoryService.startDate) < today) {
                reject('La fecha de inicio del servicio no puede ser menor a hoy');
            }
        }
        else if (advisoryService.type === AdvisoryServiceType.SPECIFIC_TOPIC.value) {
            if (advisoryService.course === undefined) {
                reject('Un servicio especializado debe tener por lo menos una materia asignada.');
            }
        }
        else {
            reject('Tipo de servicio no definido.');
        }

        resolve(advisoryService);
    });
};

AdvisoryServiceServices.getAllByStudentId = studentId => {
    return new Promise((resolve, reject) => {
        AdvisoryService.scan('studentId').eq(studentId).exec((err, services) => {
            if (err) reject(err);
            else {
                services.map(service => {
                    service.signature = md5(`${process.env.P_CUST_ID_CLIENTE}^${process.env.P_KEY}^${service.id}^${service.cost.total}^COP`);
                    return service;
                });
                resolve(services);
            }
        });
    });
};

AdvisoryServiceServices.sendNotification = (advisoryService) => {
    var notification = {
        title: "Servicio Creado",
        text: "Su servicio ha sido creado con éxito",
        type: 2,
        userId: advisoryService.studentId
    };
    NotificationServices.createNotification(notification);
};

AdvisoryServiceServices.uploadFile = (advisoryServiceId, file) => {
    var bucketName = 'tu-profe/advisory-services/' + advisoryServiceId;
    var key = uuidV4() + '.' + file.originalname.split('.').pop();

    return AdvisoryServiceServices.getAdvisoryServiceById(advisoryServiceId)
        .then(advisoryService => {
            advisoryService.totalFilesSize += file.size;
            advisoryService.files = advisoryService.files === undefined ? [] : advisoryService.files;
            advisoryService.files.push(key);

            if (advisoryService.totalFilesSize > 25000000) {
                return Promise.reject('El limite de tamaño de archivos ha sido excedido.');
            }
            else {
                S3Services.uploadFile(bucketName, key, file)
                return Promise.resolve(advisoryService);
            }
        })
        .then(advisoryService => {
            AdvisoryServiceServices.updateAdvisoryService(advisoryServiceId, advisoryService)
        });
};

AdvisoryServiceServices.assign = (advisoryServiceId, teacherId) => {
    return Promise.all([
        AdvisoryServiceServices.getAdvisoryServiceById(advisoryServiceId),
        TeacherServices.getTeacherById(teacherId)
    ])
        .then(values => {
            var advisoryService = values[0];
            var teacher = values[1];

            var teacherHasCourse = !teacher.courses.some(course => {
                return course === advisoryService.course.id
            });

            if (teacherHasCourse) {
                return Promise.reject('El profesor no dicta esta materia.')
            } else if (teacher.state !== TeacheState.ACTIVE.value) {
                return Promise.reject('El profesor esta inactivo');
            } else if (advisoryService.state !== AdvisoryServiceState.AVAILABLE.value) {
                return Promise.reject('La asesoria no esta disponible');
            }

            var message = {
                id: uuidV4(),
                teacherId: teacherId,
                advisoryServiceId: advisoryServiceId
            };

            return SQSServices.sendMessage(config.queues.assignAdvisoryService, JSON.stringify(message), 'Assign');
        });
};

AdvisoryServiceServices.getAvailableServices = (teacherId) => {
    return TeacherServices.getTeacherById(teacherId)
        .then(teacher => {
            var params = {
                courseId: { in: teacher.courses },
                state: { eq: 3 }
            };
            return Promise.all([
                ScheduleServices.getScheduleById(teacherId),
                AdvisoryServiceServices.filterByParams(params)
            ]);
        })
        .then(values => {
            var schedule = values[0];
            var advisoryServices = values[1];

            advisoryServices = advisoryServices.map(advisoryService => {
                advisoryService.matchSchedule = AdvisoryServiceServices.matchTeacherSchedule(advisoryService, schedule);
                return advisoryService;
            });

            return Promise.resolve(advisoryServices);
        });
};

AdvisoryServiceServices.matchTeacherSchedule = (advisoryService, schedule) => {
    var result = {};

    var sessions = advisoryService.sessions.filter(session => { return session.state === SessionState.PENDING.value })
        .map(session => {
            session.existsSchedule = false;
            var day = schedule.days.find(day => { return day.day === session.dayOfWeek; });

            if (day) {
                session.existsSchedule = day.sections.some(section => {
                    var startTime = parseInt(session.startTime.replace(':', ''));
                    var endTime = parseInt(session.endTime.replace(':', ''));
                    return startTime >= section.startTime && endTime <= section.endTime;
                });
            }

            return session;
        });

    result.matchSessions = sessions.filter(session => { return session.existsSchedule; }).length;
    result.percentageMatchSessions = result.matchSessions / sessions.length;

    return result;
};

module.exports = AdvisoryServiceServices;
